# Operations and Incident Response

This page explains how AquaTrace is run day to day. It covers the full response chain (alert, incident, maintenance, laboratory check, closure), the rules behind each step, the SQL and API calls the team and the officers will use, and the runbooks for when something breaks.

## Overview

AquaTrace connects four jobs into one chain. A device sends readings. Fixed rules turn bad readings into alerts. A Water Quality Officer turns an alert into an incident. A Field Officer investigates, fixes the cause and records the proof, and the Water Quality Officer closes the case.

Who does what:

| Role | Responsibility in operations |
|---|---|
| Water Quality Officer | The officer watches alerts, creates and assigns incidents, registers devices, and verifies and closes incidents. |
| Field Officer | The officer visits sites, records findings and corrective actions, logs maintenance and logs laboratory results. |
| Administrator | The admin manages accounts, reads the audit log, changes WQI weights and refreshes the Gemini files. |
| Developer on duty | The developer reads Sentry and UptimeRobot messages and follows the runbooks on this page. |

## Alerts

An alert is a saved warning that one device needs attention. The data model defines five alert types. The first release raises `threshold_breach` alerts. The other four types are in the database enum so they can be added without a migration.

| Alert type | When it is raised | Status of the rule |
|---|---|---|
| `threshold_breach` | A parameter is outside its normal limit in 3 consecutive good readings of the same device. | This rule is in the first release. |
| `wqi_change` | The WQI band of a device drops, for example from Good to Poor. | This rule is planned for a later release. |
| `device_offline` | `last_seen_at` is older than 15 minutes. | This rule is planned and runs from a scheduled job. |
| `tamper` | A message arrives with `"tamper": true` from the enclosure switch. | This rule is planned. |
| `sensor_fault` | A device reports `sensor_status = fault` for several readings in a row. | This rule is planned. |

Normal limits are constants in backend code, not rows in a table:

```python
LIMITS = {
    "ph": (6.5, 8.5),
    "temperature": (12.0, 25.0),         
    "turbidity": (None, 5.0),            
    "electrical_conductivity": (None, 1500.0), 
}
CONSECUTIVE_READINGS = 3


def breached(parameter: str, value: float | None) -> bool:
    if value is None:
        return False
    low, high = LIMITS[parameter]
    return (low is not None and value < low) or (high is not None and value > high)


def severity_for(breached_parameters: list[str]) -> str:
    return "critical" if len(breached_parameters) >= 2 else "warning"
```

Rules the engine follows on every new reading:

1. A reading with `sensor_status = fault` never counts and never raises an alert. It also does not reset the counter.
2. The engine looks at the last 3 good readings of the device. A parameter counts as breached only when it is outside its limit in all 3.
3. Severity is `warning` for 1 breached parameter and `critical` for 2 or more. Fixed rules set it. The AI never sets it.
4. If the device already has a `triggered` threshold alert, no new alert is created.
5. The alert is saved first. The AI explanation is added afterwards in a background task, so a Gemini failure never blocks an alert.
6. The alert becomes `resolved` after 3 consecutive good readings inside all limits.
7. Critical alerts notify the Water Quality Officer who registered the device (`devices.user_id`) before any incident exists, so they can act early.

Officers read and act on alerts through these calls:

```bash
# Open critical alerts first
curl "$API/alerts?status=triggered&severity=critical" -H "Authorization: Bearer $TOKEN"

# One alert with its AI explanation
curl "$API/alerts/$ALERT_ID" -H "Authorization: Bearer $TOKEN"

# Read the current limits and rule settings (read only)
curl "$API/alerts/limits" -H "Authorization: Bearer $TOKEN"

# Ask for a new AI explanation
curl -X POST "$API/alerts/$ALERT_ID/explanation" -H "Authorization: Bearer $TOKEN"

# Mark a false alarm as resolved
curl -X PATCH "$API/alerts/$ALERT_ID/resolve" -H "Authorization: Bearer $TOKEN"
```

A response for one alert looks like this:

```json
{
  "alert_id": "6f1c1c1e-6b0e-4c61-9d0b-0f6d1e3a7a10",
  "device_id": "0b8f3d52-8f3a-4f55-8a0e-6c1b7d1a2e90",
  "reading_id": "c3d2a7a1-5c3f-4d0e-9f7a-2b5b8b7f1d44",
  "alert_type": "threshold_breach",
  "parameter": null,
  "observed_value": null,
  "severity": "critical",
  "message": "turbidity and electrical_conductivity are above their limits in 3 readings",
  "status": "triggered",
  "ai_explanation": "What changed: ...",
  "ai_generated_at": "2026-10-26T11:26:40Z",
  "created_at": "2026-10-26T11:25:02Z"
}
```

`parameter` holds the worst parameter for a one-parameter alert. It is `null` when two or more parameters breach, and the `message` lists them.

The AI explanation has four parts: What changed, Evidence used, Still to confirm, and Ideas to check. It is advice only. It never says the water is safe or unsafe. See [AI](/ai/) for the full design.

Useful alert queries:

```sql
SELECT a.created_at, d.serial_number, d.name, a.severity, a.alert_type, a.message,
       u.email AS notified_user
FROM alerts a
JOIN devices d ON d.device_id = a.device_id
JOIN users u ON u.user_id = d.user_id
WHERE a.status = 'triggered'
ORDER BY (a.severity = 'critical') DESC, a.created_at DESC;

SELECT a.alert_id, d.serial_number, a.created_at
FROM alerts a
JOIN devices d ON d.device_id = a.device_id
LEFT JOIN incidents i ON i.alert_id = a.alert_id
WHERE a.severity = 'critical'
  AND a.status = 'triggered'
  AND i.incident_id IS NULL
  AND a.created_at < now() - interval '30 minutes';
```

## Incident Investigation

A Water Quality Officer uses an alert as the starting point. One alert can start at most one incident (`incidents.alert_id` is unique). The incident is then assigned to a Field Officer.

The status moves in one direction, with one allowed step back when verification fails:

| Action | Who can do it | What the system checks |
|---|---|---|
| Create an incident | Only a Water Quality Officer can create one. | The alert must exist and must not already have an incident, and `priority` is required. |
| Assign a Field Officer | Only a Water Quality Officer can assign one. | The assigned user must have the role `field_officer` and the status `active`. |
| Move to investigating | The assigned Field Officer or a Water Quality Officer can do it. | The status must be `open`. |
| Record findings and corrective action | The assigned Field Officer or a Water Quality Officer can do it. | The incident must not be closed. |
| Move to awaiting verification | The assigned Field Officer can do it. | `findings`, `corrective_action` and `visited_at` must all be filled. |
| Close the incident | Only a Water Quality Officer can close it. | The status must be `awaiting_verification` and the closure checks below must pass. |

The transition rules live in one small function so the router, the tests and this page all use the same table:

```python
ALLOWED_TRANSITIONS = {
    "open": {"investigating"},
    "investigating": {"awaiting_verification"},
    "awaiting_verification": {"investigating", "closed"},
    "closed": set(),
}

ROLE_CAN_SET = {
    "field_officer": {"investigating", "awaiting_verification"},
    "water_quality_officer": {"investigating", "awaiting_verification", "closed"},
}


class TransitionError(Exception):
    pass


def check_transition(current: str, new: str, role: str) -> None:
    if new not in ALLOWED_TRANSITIONS.get(current, set()):
        raise TransitionError(f"Cannot move from {current} to {new}")
    if new not in ROLE_CAN_SET.get(role, set()):
        raise TransitionError(f"Role {role} cannot set status {new}")


def check_ready_for_review(incident) -> None:
    missing = [
        name
        for name in ("findings", "corrective_action", "visited_at")
        if getattr(incident, name) in (None, "")
    ]
    if missing:
        raise TransitionError("Fill these first: " + ", ".join(missing))
```

The router maps `TransitionError` to a 409 response with the body `{"detail": "...", "code": "invalid_transition"}`.

Example calls for one incident:

```bash
curl -X POST "$API/incidents" -H "Authorization: Bearer $WQO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"alert_id": "'"$ALERT_ID"'", "priority": "high", "assigned_to": "'"$FIELD_USER_ID"'"}'

curl -X PATCH "$API/incidents/$INCIDENT_ID" -H "Authorization: Bearer $FIELD_TOKEN" \
  -H "Content-Type: application/json" -d '{"status": "investigating"}'

curl -X PATCH "$API/incidents/$INCIDENT_ID" -H "Authorization: Bearer $FIELD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "visited_at": "2026-10-26T13:10:00Z",
    "findings": "Valve V2 was half open and the chamber was full of silt.",
    "corrective_action": "Flushed the chamber, cleaned the turbidity window, reopened V2.",
    "status": "awaiting_verification"
  }'
```

Every create, assign, status change and close writes a row to `audit_logs`:

| Action name | When it is written | Example `details` |
|---|---|---|
| `incident_created` | An officer creates an incident. | `{"alert_id": "...", "priority": "high"}` |
| `incident_assigned` | `assigned_to` changes. | `{"from": null, "to": "..."}` |
| `incident_status_changed` | The status changes. | `{"from": "open", "to": "investigating"}` |
| `incident_closed` | A Water Quality Officer closes it. | `{"resolved_by": "..."}` |

Queries for managers:

```sql
SELECT u.first_name, u.last_name, count(*) AS open_incidents
FROM incidents i
JOIN users u ON u.user_id = i.assigned_to
WHERE i.status <> 'closed'
GROUP BY 1, 2
ORDER BY open_incidents DESC;

SELECT incident_id, priority, created_at
FROM incidents
WHERE assigned_to IS NULL AND status = 'open'
ORDER BY priority DESC, created_at;

SELECT round(avg(extract(epoch FROM (closed_at - created_at)) / 3600)::numeric, 1) AS avg_hours
FROM incidents
WHERE status = 'closed' AND closed_at > now() - interval '90 days';
```

## Maintenance and Calibration

Maintenance records are the history of work on a device. They help an officer decide if an odd reading is a water change or a sensor problem. The three types are `calibration`, `cleaning` and `repair`. The status is `scheduled` or `completed`.

| Work | How often | What the Field Officer does |
|---|---|---|
| Calibration of the pH sensor | Every month, or sooner if readings drift. | The officer uses fresh buffer solutions and records the value before and after. |
| Calibration of the EC sensor | Every month, or sooner if readings drift. | The officer uses a reference solution and records the value before and after. |
| Check of the turbidity sensor | Every month. | The officer checks it against a reference sample and cleans the window. |
| Cleaning of sensors and chamber | Every 2 weeks, or after a turbidity alert. | The officer isolates the chamber with the valves, cleans it and opens the valves again. |
| Repair | When a sensor fault or tamper alert is confirmed. | The officer replaces the part and logs what was changed. |
| Power and enclosure check | Every 3 months. | The officer tests the backup battery, checks seals and checks the tamper switch. |

Fields that matter:

| Field | How it is used |
|---|---|
| `pre_maintenance_value` | It stores the reading before the work, so drift can be measured. |
| `post_maintenance_value` | It stores the reading after the work, so the effect of the work can be checked. |
| `next_scheduled_date` | It stores the date of the next planned job, which feeds the monthly due-date check. |
| `incident_id` | It links the work to an incident, or stays empty for routine work. It is set to null if the incident is deleted. |

Log the work and read the history:

```bash
curl -X POST "$API/devices/$DEVICE_ID/maintenance" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "maintenance_type": "calibration",
    "status": "completed",
    "incident_id": null,
    "pre_maintenance_value": 7.31,
    "post_maintenance_value": 7.00,
    "performed_at": "2026-10-26T09:30:00Z",
    "next_scheduled_date": "2026-11-26",
    "notes": "pH 7 buffer, probe cleaned first"
  }'

curl "$API/devices/$DEVICE_ID/maintenance" -H "Authorization: Bearer $TOKEN"
```

To separate a sensor problem from a real water change, compare readings one hour before and one hour after each maintenance job:

```sql
SELECT m.performed_at, m.maintenance_type, d.serial_number,
       avg(r.ph) FILTER (WHERE r.recorded_at < m.performed_at) AS ph_before,
       avg(r.ph) FILTER (WHERE r.recorded_at >= m.performed_at) AS ph_after,
       avg(r.turbidity) FILTER (WHERE r.recorded_at < m.performed_at) AS turb_before,
       avg(r.turbidity) FILTER (WHERE r.recorded_at >= m.performed_at) AS turb_after
FROM maintenance_records m
JOIN devices d ON d.device_id = m.device_id
JOIN sensor_readings r
  ON r.device_id = m.device_id
 AND r.recorded_at BETWEEN m.performed_at - interval '1 hour'
                       AND m.performed_at + interval '1 hour'
 AND r.sensor_status = 'ok'
WHERE m.status = 'completed'
GROUP BY m.maintenance_id, m.performed_at, m.maintenance_type, d.serial_number
ORDER BY m.performed_at DESC;
```

If the values jump right after the work and the neighbouring devices did not change, the cause was most likely the sensor. If the neighbours changed too, the cause was most likely the water.

Jobs due soon:

```sql
SELECT d.serial_number, m.maintenance_type, m.next_scheduled_date
FROM maintenance_records m
JOIN devices d ON d.device_id = m.device_id
WHERE m.next_scheduled_date <= current_date + 7
ORDER BY m.next_scheduled_date;
```

## Laboratory Verification

Laboratory results are the proof that checks what the sensors suggest. A sensor measures pH, temperature, turbidity and EC only. A laboratory can test other things, such as chlorine residual or bacteria. Lab results live in `lab_tests` and are never mixed into `sensor_readings`.

Each row is one parameter result for one incident. The database checks that `tested_at` is not earlier than `sample_collected_at`.

```bash
curl -X POST "$API/incidents/$INCIDENT_ID/lab-tests" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "laboratory_name": "County Water Lab",
    "parameter": "free chlorine",
    "result_value": 0.1,
    "unit": "mg/L",
    "sample_collected_at": "2026-10-26T13:30:00Z",
    "tested_at": "2026-10-26T16:00:00Z",
    "notes": "Below the 0.2 mg/L target at the tap"
  }'

curl "$API/incidents/$INCIDENT_ID/lab-tests" -H "Authorization: Bearer $TOKEN"
```

Pydantic rejects a bad time order before the database does:

```python
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class LabTestCreate(BaseModel):
    laboratory_name: str = Field(min_length=1, max_length=100)
    parameter: str = Field(min_length=1, max_length=50)
    result_value: float
    unit: str = Field(min_length=1, max_length=20)
    sample_collected_at: datetime
    tested_at: datetime | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def tested_after_sampling(self):
        if self.tested_at and self.tested_at < self.sample_collected_at:
            raise ValueError("tested_at must not be before sample_collected_at")
        return self
```

To compare a lab result with the sensor value at the time the sample was taken:

```sql
SELECT l.parameter, l.result_value, l.unit, l.sample_collected_at,
       r.recorded_at, r.ph, r.turbidity, r.electrical_conductivity
FROM lab_tests l
JOIN incidents i ON i.incident_id = l.incident_id
JOIN alerts a ON a.alert_id = i.alert_id
JOIN LATERAL (
    SELECT * FROM sensor_readings sr
    WHERE sr.device_id = a.device_id
      AND sr.recorded_at <= l.sample_collected_at
    ORDER BY sr.recorded_at DESC
    LIMIT 1
) r ON true
WHERE l.incident_id = 'PUT_INCIDENT_UUID_HERE';
```

## Closure and Traceability

A Water Quality Officer closes an incident only after proof that the problem is fixed. The close call runs these checks before it changes anything:

1. The status is `awaiting_verification`.
2. `findings`, `corrective_action` and `visited_at` are filled.
3. The device has at least 3 good readings after `visited_at` that are inside all limits.
4. The user closing the incident has the role `water_quality_officer`.

```python
from datetime import datetime, timezone

from sqlalchemy import select

from models.sensor_reading import SensorReading
from services.alert_engine import CONSECUTIVE_READINGS, LIMITS, breached


def follow_up_is_good(db, device_id, since, needed: int = CONSECUTIVE_READINGS) -> bool:
    stmt = (
        select(SensorReading)
        .where(
            SensorReading.device_id == device_id,
            SensorReading.recorded_at > since,
            SensorReading.sensor_status == "ok",
        )
        .order_by(SensorReading.recorded_at.desc())
        .limit(needed)
    )
    rows = list(db.scalars(stmt))
    if len(rows) < needed:
        return False
    return not any(breached(p, getattr(r, p)) for r in rows for p in LIMITS)


def close_incident(db, incident, user):
    check_transition(incident.status, "closed", user.role)
    check_ready_for_review(incident)
    if not follow_up_is_good(db, incident.alert.device_id, incident.visited_at):
        raise TransitionError("Follow-up readings are not yet inside the limits")
    now = datetime.now(timezone.utc)
    incident.status = "closed"
    incident.resolved_by = user.user_id
    incident.closed_at = now
    incident.updated_at = now
```

```bash
curl -X POST "$API/incidents/$INCIDENT_ID/close" -H "Authorization: Bearer $WQO_TOKEN"
```

The whole story of one incident can be rebuilt from the database. This query joins the alert, the incident, the maintenance work, the lab results and the audit log into one timeline:

```sql
WITH inc AS (
    SELECT i.incident_id, i.alert_id, a.device_id
    FROM incidents i
    JOIN alerts a ON a.alert_id = i.alert_id
    WHERE i.incident_id = 'PUT_INCIDENT_UUID_HERE'
)
SELECT a.created_at AS at, 'alert' AS kind, a.severity || ': ' || a.message AS detail
FROM alerts a JOIN inc ON inc.alert_id = a.alert_id
UNION ALL
SELECT i.created_at, 'incident_created', 'priority ' || i.priority
FROM incidents i JOIN inc ON inc.incident_id = i.incident_id
UNION ALL
SELECT m.performed_at, 'maintenance', m.maintenance_type::text || ' (' || m.status::text || ')'
FROM maintenance_records m JOIN inc ON inc.incident_id = m.incident_id
UNION ALL
SELECT l.sample_collected_at, 'lab_sample', l.parameter || ' = ' || l.result_value || ' ' || l.unit
FROM lab_tests l JOIN inc ON inc.incident_id = l.incident_id
UNION ALL
SELECT g.created_at, 'audit', g.action
FROM audit_logs g JOIN inc ON g.entity_id = inc.incident_id
UNION ALL
SELECT i.closed_at, 'incident_closed', 'closed'
FROM incidents i JOIN inc ON inc.incident_id = i.incident_id
WHERE i.closed_at IS NOT NULL
ORDER BY at;
```

What the record keeps for each incident:

| Item | Where it is stored | Why it matters |
|---|---|---|
| The reading that caused the alert | `alerts.reading_id` points to `sensor_readings`. | It shows the exact measurement behind the alert. |
| The AI explanation | `alerts.ai_explanation` and `alerts.ai_generated_at`. | It shows what the assistant said and when. |
| Who handled the case | `incidents.assigned_to` and `incidents.resolved_by`. | It shows who investigated and who verified. |
| What was found and done | `incidents.findings`, `corrective_action`, `visited_at`. | It shows the field work. |
| Device work | `maintenance_records` linked by `incident_id`. | It shows if the sensor was repaired or cleaned. |
| Lab proof | `lab_tests` linked by `incident_id`. | It shows outside confirmation. |
| Every key action | `audit_logs`, which cannot be edited or deleted. | It shows who did what and when. |

## Monitoring

| Tool | What it watches | What the team does with it |
|---|---|---|
| Sentry | It collects errors from the backend and the IoT API. | The team gets an email on a new error and fixes the cause the same week. |
| UptimeRobot | It calls the public URLs on a schedule. | The team gets a message when a check fails twice in a row. |
| Supabase logs | They show slow queries, failed logins to the database and connection counts. | The team reads them during any slow-dashboard report. |
| Render logs | They show the backend and the IoT API output. | The team searches them by reason code when a device goes silent. |

UptimeRobot checks:

| Check | Target | Interval |
|---|---|---|
| Backend health | `GET /api/v1/health` must return 200. | Every 5 minutes. |
| Frontend | The Vercel home page must return 200. | Every 5 minutes. |
| Login page | `/login` must return 200. | Every 10 minutes. |
| Heartbeat for the IoT API | The worker calls a heartbeat URL every 5 minutes and an alert fires if it stops. | Every 5 minutes. |

All services write one JSON object per line so logs are easy to search:

```json
{"ts":"2026-10-26T11:20:03Z","level":"warning","service":"iot-api","event":"message_rejected","reason":"duplicate_message","serial_number":"AQT-0001","message_number":1042}
```

```python
import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record):
        data = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "level": record.levelname.lower(),
            "service": "backend",
            "event": record.getMessage(),
        }
        data.update(getattr(record, "extra_data", {}))
        return json.dumps(data)


handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
logging.getLogger().addHandler(handler)
logging.getLogger().setLevel(logging.INFO)
```

Rejected readings are not stored in the database, so these log lines are the only record. The team searches for `message_rejected` to find them.

## Device fleet health

A device is offline when `last_seen_at` is older than 3 times the publish interval, which is 15 minutes with the default 300 second interval. A backend job checks every minute and raises a `device_offline` alert.

```python
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from models.device import Device

PUBLISH_INTERVAL_S = 300
OFFLINE_AFTER = timedelta(seconds=3 * PUBLISH_INTERVAL_S)


def find_silent_devices(db):
    cutoff = datetime.now(timezone.utc) - OFFLINE_AFTER
    stmt = select(Device).where(Device.status == "active", Device.last_seen_at < cutoff)
    return list(db.scalars(stmt))
```

The same list in SQL:

```sql
SELECT serial_number, name, address, last_seen_at,
       now() - last_seen_at AS silent_for
FROM devices
WHERE status = 'active'
  AND last_seen_at < now() - interval '15 minutes'
ORDER BY last_seen_at;
```

A data quality check for one device over the last day:

```sql
SELECT date_trunc('hour', recorded_at) AS hour,
       count(*) AS readings,
       count(*) FILTER (WHERE is_buffered) AS buffered,
       count(*) FILTER (WHERE sensor_status = 'fault') AS faults
FROM sensor_readings
WHERE device_id = 'PUT_DEVICE_UUID_HERE'
  AND recorded_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 1;
```

With a 300 second interval, a healthy device gives about 12 readings per hour.

## Data retention and backups

| Data | How long it is kept | How it is protected |
|---|---|---|
| Sensor readings | The team keeps them for at least 2 years so trends and past incidents can be checked. | Supabase makes automated daily backups. |
| Alerts, incidents, lab tests, maintenance records | They are kept without a limit because they are the traceable record of the response. | They are in the same daily backup. |
| Audit logs | They are kept without a limit and cannot be changed or deleted by the app. | They are in the same daily backup and the database triggers block edits. |
| Gemini file references | Rows are kept but marked expired after 48 hours, and the files are uploaded again when needed. | They can be rebuilt from the markdown files, so they need no special backup. |
| Application logs | Render and Sentry keep them for the period of the chosen plan. | The team exports any log that is part of an incident review. |

Restore test (every quarter and before go-live):

```bash
pg_dump "$DATABASE_URL" --format=custom --file=aquatrace_$(date +%Y%m%d).dump

createdb aquatrace_restore_test
pg_restore --no-owner --dbname=aquatrace_restore_test aquatrace_$(date +%Y%m%d).dump

for t in users devices sensor_readings alerts incidents audit_logs; do
  echo -n "$t prod: "; psql "$DATABASE_URL" -tAc "SELECT count(*) FROM $t"
  echo -n "$t test: "; psql aquatrace_restore_test -tAc "SELECT count(*) FROM $t"
done

dropdb aquatrace_restore_test
```

## Runbooks

### Device offline

1. Run the silent devices SQL above and note the serial number.
2. Search the IoT API log for that serial number to see if messages are being rejected.
3. Check the HiveMQ client list to see if the device is connected.
4. If it is not connected, ask the Field Officer to check power, the SIM balance and signal.
5. When the node comes back, buffered readings arrive in order with `is_buffered = true`. Check the hourly count query above.
6. Log the repair or visit as a maintenance record.

### Burst of alerts

1. Open the alerts page and check if many devices alert at once. One site alerting is a local problem, but many sites may mean a bad rule or a bad deploy.
2. Check the last deploy in Render and the Sentry errors.
3. Count the alerts by type:

```sql
SELECT alert_type, severity, count(*)
FROM alerts
WHERE created_at > now() - interval '1 hour'
GROUP BY 1, 2
ORDER BY 3 DESC;
```

4. If a bad release caused it, follow the rollback runbook.
5. Resolve false alerts with `PATCH /api/v1/alerts/{alert_id}/resolve` and write the cause in the incident notes.

### Gemini errors or key leak

1. If errors are 429, the free quota is used. Alerts still work. Wait for the quota to reset, then use the regenerate route.
2. If errors are 403 or 404 for a file, the upload expired. Refresh the files:

```bash
curl -X POST "$API/gemini-files/sync" -H "Authorization: Bearer $ADMIN_TOKEN"
curl "$API/gemini-files" -H "Authorization: Bearer $ADMIN_TOKEN"
```

3. If the key may have leaked, create a new key in Google AI Studio, update `GEMINI_API_KEY` in Render, redeploy, then delete the old key.
4. Search the repo and logs for the old key and remove any copy.

### Database restore

1. Stop writes: suspend the IoT API worker in Render.
2. Take a dump of the current state, even if damaged, for the review.
3. Restore the chosen backup into a scratch database and check the row counts.
4. Use the Supabase restore feature for production or load the dump with `pg_restore`.
5. Run `uv run alembic current` and make sure the version matches the code.
6. Resume the IoT API worker. Buffered device data will fill the gap.

### MQTT broker down

1. Check the HiveMQ Cloud status page and the cluster in the console.
2. Devices keep sampling and store readings in `/buffer.jsonl`, so no data is lost in a normal outage.
3. When the broker is back, the IoT API reconnects. If it does not, restart the worker in Render.
4. Check that buffered readings arrive, using the hourly count query.

### Bad deployment rollback

1. In Render, open the service, open Events and roll back to the last good deploy.
2. In Vercel, open Deployments and promote the last good deployment.
3. If a migration ran, read it, take a `pg_dump`, then decide whether `uv run alembic downgrade -1` is safe.
4. Run the smoke test from [Deployment](/deployment/).
5. Open a Jira bug with the cause and the fix.

### Account lockout reset by admin

1. The user reports a locked account. The lock ends by itself after 15 minutes.
2. To unlock sooner, the Admin runs this in the Supabase SQL editor:

```sql
UPDATE users
SET failed_login_attempts = 0, locked_until = NULL, otp_attempts = 0, updated_at = now()
WHERE email = 'user@example.com';
```

3. Check the audit log for the cause. Many failures from one IP may be an attack, so use the incident response steps in [Security](/security/).
4. If the user lost their authenticator, the Admin sets `mfa_enabled` to false only after confirming the person's identity. The user then sets up TOTP again.

## Key rotation procedure

1. Pick the secret from the table in [Security](/security/).
2. Create the new value in the provider (Google, SMTP, HiveMQ, Supabase) or generate it:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

3. Set the new value in Render, Vercel or GitHub Secrets.
4. Redeploy the service and run the smoke test.
5. Delete the old key in the provider.
6. Write the date and the reason in the rotation log, never the value.

## On-call and escalation

| Level | Who | When |
|---|---|---|
| Level 1 | The developer on duty for the week reads Sentry and UptimeRobot messages. | They act within 1 working hour of a message during working hours. |
| Level 2 | The service owner (backend, IoT, frontend or AI) fixes the cause. | The developer on duty hands over when the fix needs deep knowledge. |
| Level 3 | The team lead and the trainer decide on rollbacks, data restore and outside messages. | A data loss, a security leak or a long outage reaches this level. |
| Field | The Field Officer visits the device. | A device is offline for more than 1 hour or a tamper alert is confirmed. |

## Service level targets

These are targets for the plan, not measured results.

| Target | Value |
|---|---|
| Backend availability | The target is 99 percent of each month. |
| Time from reading to dashboard | The target is under 10 seconds from the message arriving at HiveMQ. |
| Time from third bad reading to alert | The target is under 1 minute after the third bad reading is stored. |
| Time from critical alert to incident decision | The target is under 30 minutes during working hours. |
| Time to restore from backup | The target is under 4 hours. |
| Device offline detection | The target is within 15 minutes of the last message. |

## Implementation verification

Before this page is final, the team checks each rule against the code. The commands below find the places to read and prove the rules with tests.

```bash
grep -rn "CONSECUTIVE_READINGS\|LIMITS" services/ routers/
grep -rn "ALLOWED_TRANSITIONS\|check_transition" services/ routers/
grep -rn "audit(" routers/ services/

psql "$DATABASE_URL" -c "\dT+ alert_type"
psql "$DATABASE_URL" -c "\dT+ incident_status"
psql "$DATABASE_URL" -c "\dT+ maintenance_status"

uv run alembic current
uv run alembic heads

uv run pytest -k "alert or incident or maintenance or lab" -q
```

Checklist:

| Item to verify | Where to look | Expected result |
|---|---|---|
| Alert after 3 good readings | `services/alert_engine.py` and its tests | A fault reading is skipped and never alerts. |
| Severity rule | `severity_for` | One parameter gives warning and two or more give critical. |
| Incident roles | `routers/incidents.py` | Only a Water Quality Officer creates, assigns and closes. |
| Status transitions | `services/incident_rules.py` | Any other move returns 409. |
| Maintenance routes | `routers/maintenance.py` | Field Officers and Water Quality Officers can log and read. |
| Lab test routes | `routers/lab_tests.py` | `tested_at` before `sample_collected_at` is rejected. |
| Audit entries | `audit_logs` after a test run | Each action in the audit table above has a row. |
| Enum labels | `\dT+` output | The labels match the data model. |

## Glossary

| Term | Meaning |
|---|---|
| WQI | The Water Quality Index is one score that sums up the four parameters. |
| EC | Electrical conductivity is a measure of dissolved salts, in uS/cm. |
| NTU | Nephelometric turbidity unit, the unit for cloudiness of water. |
| MQTT | A small message protocol that devices use to publish data to a broker. |
| Broker | The server that receives MQTT messages and passes them to subscribers. |
| Buffered reading | A reading kept on the device during an outage and sent later. |
| RLS | Row Level Security is a database rule that limits which rows a role can see. |
| TOTP | A time based one-time password made by an authenticator app. |
| RAG | The AI reads chosen guideline documents before it writes its explanation. |
| Runbook | A numbered list of steps to fix a known problem. |

## Related pages

- [Backend](/backend/)
- [Database](/database/)
- [WQI](/wqi/)
- [AI](/ai/)
- [IoT](/iot/)
- [Security](/security/)
- [Deployment](/deployment/)