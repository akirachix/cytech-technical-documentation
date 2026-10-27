# Data Flow

## 1. Overview

AquaTrace is intended to connect water-quality measurements with assessment, visualisation, and operational response. This page describes the logical data flow and identifies integration details that must be verified against the current implementation.

The stages, in order, are:

| Stage | What happens | Status |
|---|---|---|
| 1. Collect | A node samples pH, temperature, turbidity and electrical conductivity and reads GPS | Designed |
| 2. Transport | The node publishes the reading over MQTT with TLS to the broker | Designed |
| 3. Ingest | A subscriber receives the message and the reading reaches the sensor-readings ingestion service | To verify |
| 4. Validate and store | The backend checks the device, rejects duplicates, validates values and stores the reading | Verified |
| 5. Assess | The WQI score and status band are calculated and stored with the reading | Verified |
| 6. Signal | Thresholds and device state are evaluated and alerts are recorded | Alert model verified, trigger rules to verify |
| 7. Explain | An advisory explanation is generated from approved documents | Designed |
| 8. Display | The frontend retrieves readings, alerts and incidents through the API | Routes verified |
| 9. Respond | Officers create incidents, record findings and close them after review | Designed |
| 10. Record | Sign-ins and account changes are written to the audit log | Verified model and routes |

## 2. End-to-End Data-Flow Diagram

The System Architecture Diagram also serves as the end-to-end data-flow diagram, because it shows the path from sensor measurement through telemetry, backend validation, persistence, WQI processing, frontend display, and operational review. Click the image or the expand icon to open it full screen.


<a href="/User Flow - Water Quality Officer.jpg" target="_blank">
  <img src="/User Flow - Water Quality Officer.jpg" alt="AquaTrace user flow. Click to open full size." style="max-width: 100%; height: auto;" />
</a>

Include external services in the diagram only where the connections are verified.

## 3. Sensor Data Collection

Monitoring devices are intended to collect water-quality measurements such as pH, temperature, turbidity, and electrical conductivity.

According to the architecture diagram the field hardware is:

| Item | Role |
|---|---|
| ESP32 | Microcontroller that reads the sensors and publishes messages |
| Temperature sensor | Water temperature |
| Turbidity sensor | Analog turbidity reading (NTU) |
| Electrical conductivity sensor | Analog EC reading |
| pH sensor | Analog pH reading |
| GPS module (NEO-6M) | Location and time from NMEA sentences |
| Cellular gateway | Connects the node to the broker |

The actual sensor models, sampling intervals, calibration constants, device-side validation, and buffering rules must be confirmed from the project's device and integration documentation. See [IoT Monitoring](../iot/).

## 4. Telemetry and Backend Ingestion

The intended architecture transfers device data to the backend through a telemetry integration.

```text
ESP32 --MQTT over TLS (8883)--> HiveMQ broker --subscribe--> Node.js subscriber --> backend ingestion
```

The active transport, message format, authentication, retry handling, duplicate detection, and complete device-to-database path must be verified against the current integration code. The existence of device APIs does not establish that physical telemetry is connected end to end.

### Ingestion contract

The backend ingestion service expects a payload with these fields. This is taken from the fields the service reads.

| Field | Type | Notes |
|---|---|---|
| `device_id` | string (UUID) | Must belong to a registered device |
| `message_number` | integer | Per-device counter used for duplicate detection |
| `ph` | number | 0 to 14 when the sensor status is OK |
| `temperature` | number | Degrees C |
| `turbidity` | number | NTU, not negative |
| `electrical_conductivity` | number | uS/cm, not negative |
| `sensor_status` | enum | When it is `OK` the WQI is calculated |
| `recorded_at` | timestamp | UTC time the reading was taken on the device |

Example request, suitable for testing the ingestion endpoint locally:

```bash
curl -X POST "http://localhost:8000/sensor-readings/" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "7c1f2d9e-3a48-4b6f-9a2e-5d0b1c8e4f10",
    "message_number": 10482,
    "ph": 7.2,
    "temperature": 22.4,
    "turbidity": 6.8,
    "electrical_conductivity": 520.0,
    "sensor_status": "ok",
    "recorded_at": "2026-10-14T09:12:00Z"
  }'
```

::: tip
Add an `Authorization: Bearer <token>` header if the route is protected in your environment, and use the enum spelling defined in the `SensorStatus` model for `sensor_status`.
:::

## 5. Validation and Persistence

Before readings are used by the application, the backend should validate the incoming data according to the rules implemented for the relevant endpoint or ingestion service.

PostgreSQL stores application records, with SQLAlchemy providing database access and Alembic tracking schema changes.

### Verified ingestion behaviour

| Situation | Result |
|---|---|
| `device_id` is not a valid UUID | `404`, device not found |
| Device does not exist | `404`, asks the caller to register the device first |
| Same `device_id` and `message_number` already stored | The existing reading is returned and nothing new is stored |
| `sensor_status` is `OK` and exactly four weights exist | WQI score and status are calculated |
| `sensor_status` is not `OK` | Reading is stored with no WQI score or status |
| A value is out of range or not finite | `422` with the validation message |
| Reading received more than 300 seconds after `recorded_at` | Stored with `is_buffered = true` |
| Database integrity error on insert | Transaction rolled back and `404` returned |

The core of the service is short enough to read in full:

```python
existing_reading = get_reading_by_device_and_message(db, device_uuid, payload.message_number)
if existing_reading:
    return existing_reading            

wqi_score = None
wqi_status = None

if payload.sensor_status == SensorStatus.OK:
    weights = fetch_active_weights(db)
    if len(weights) == 4:
        scores = {
            "ph": normalize_ph(payload.ph),
            "temperature": normalize_temperature(payload.temperature),
            "turbidity": normalize_turbidity(payload.turbidity),
            "electrical_conductivity": normalize_ec(payload.electrical_conductivity),
        }
        wqi_score = round(sum(scores[name] * weights[name] for name in PARAMETERS), 2)
        wqi_status = assign_wqi_status(wqi_score)

now = datetime.now(timezone.utc)
is_buffered = (now - payload.recorded_at).total_seconds() > 300
```

The exact behaviour for stale timestamps in the future, partially populated measurements and malformed payloads must still be verified from the implementation and tests.

## 6. Water Quality Index Processing

WQI processing produces an assessment from measurement data using defined calculation rules.

The formula, parameter weights, classification boundaries, units, and treatment of missing or invalid values must be confirmed against the current backend service and approved project requirements.

A WQI score is a calculated assessment. It must remain distinguishable from the original sensor measurements.

### Normalisation rules in the service

Each parameter is converted to a 0 to 100 sub-score before weighting.

| Parameter | 100 (ideal) | Linear decline | 0 (worst) |
|---|---|---|---|
| pH | 6.5 to 8.5 | 5.5 to 6.5 and 8.5 to 9.5 | Below 5.5 or above 9.5 |
| Temperature (degrees C) | 20 to 25 | 15 to 20 and 25 to 30 | Below 15 or above 30 |
| Turbidity (NTU) | 1 or less | Above 1 up to 5 | 5 or more |
| EC (uS/cm) | 1000 or less | Above 1000 up to 1500 | 1500 or more |

```python
def normalize_turbidity(turbidity: float) -> float:
    if not math.isfinite(turbidity) or turbidity < 0.0:
        raise ValueError("Turbidity must be finite and non-negative.")
    if turbidity <= 1.0:
        return 100.0
    if turbidity < 5.0:
        return ((5.0 - turbidity) / 4.0) * 100.0
    return 0.0
```

### Status bands

```python
def assign_wqi_status(score: float) -> WqiStatus:
    if score > 79.0:
        return WqiStatus.EXCELLENT
    if score > 51.0:
        return WqiStatus.GOOD
    if score > 36.0:
        return WqiStatus.REGULAR
    if score > 19.0:
        return WqiStatus.POOR
    return WqiStatus.VERY_POOR
```

| Score | Status |
|---|---|
| Above 79 | Excellent |
| Above 51 up to 79 | Good |
| Above 36 up to 51 | Regular |
| Above 19 up to 36 | Poor |
| 19 or below | Very Poor |

### Worked example (illustrative weights)

The weights below are examples only, to show the arithmetic. The real weights are rows in the `wqi_weights` table.

| Parameter | Reading | Sub-score | Weight | Contribution |
|---|---|---|---|---|
| pH | 7.2 | 100 | 0.30 | 30.00 |
| Turbidity | 6.8 NTU | 0 | 0.30 | 0.00 |
| EC | 520 uS/cm | 100 | 0.25 | 25.00 |
| Temperature | 22.4 degrees C | 100 | 0.15 | 15.00 |
| **WQI** | | | | **70.00 (Good)** |

You can reproduce the sub-scores in a Python shell:

```python
>>> normalize_ph(7.2)
100.0
>>> normalize_turbidity(6.8)
0.0
>>> normalize_ec(520)
100.0
>>> normalize_temperature(22.4)
100.0
```

## 7. Frontend Data Retrieval

The web frontend obtains information through backend APIs. The interface can present device details, readings, WQI information, and maintenance records when those records and endpoints are available.

| Screen | Data it needs | Routes |
|---|---|---|
| Dashboard | Latest reading per node, alerts, device count | `GET /sensor-readings/latest`, `GET /alerts`, `GET /api/v1/devices` |
| Node detail and history | Readings for one node | `GET /sensor-readings/device/{device_id}` |
| Alerts | Alert list and detail, mark as seen or resolved | `GET /alerts`, `GET /alerts/{alert_id}`, `PATCH /alerts/{alert_id}/seen`, `PATCH /alerts/{alert_id}/resolve` |
| Maintenance | Calibration and maintenance history | `GET /maintenance-records`, `POST /maintenance-records` |
| Laboratory results | Lab tests for an incident | `GET /lab-tests`, `POST /lab-tests` |
| Users and audit log | Administration | `GET /users`, `GET /audit-logs` |

Loading states, empty results, API errors, and pagination affect how this information is displayed. A successful frontend build does not, by itself, confirm that the complete runtime workflow works.

A small typed helper that keeps these states explicit:

```ts
// Illustrative: model the three states the UI must render
type Remote<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

async function load<T>(fn: () => Promise<T>): Promise<Remote<T>> {
  try {
    return { status: "ready", data: await fn() };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Unknown error" };
  }
}
```

## 8. Alerts and Operational Response

The broader AquaTrace requirements describe using abnormal water-quality conditions to support alert review and incident response.

The conditions that trigger alerts, any incident-creation process, authorised state transitions, and the relationship between measurements and operational records must be documented from the active backend implementation.

An alert is not itself proof of contamination. Investigation and additional evidence may be required.

### What the alert model supports

| Capability | Model support |
|---|---|
| Different kinds of signal | `alert_type`: threshold breach, WQI change, device offline, tamper, sensor fault |
| Severity | `warning` or `critical` |
| Link to evidence | `device_id` and optional `reading_id`, plus `observed_value` and `threshold_value` |
| Grouping of repeats | `occurrence_count` |
| New versus seen | `seen_at` timestamp |
| Officer notification tracking | `officers_notified_at` |
| Advisory explanation | `ai_explanation` and `ai_generated_at` |

### Intended alert-to-incident path

```text
Reading stored
   -> thresholds or device state evaluated
   -> alert recorded (or occurrence_count increased if the same condition is already open)
   -> Water Quality Officer opens the alert (seen_at set)
   -> incident created and assigned to a Field Officer
   -> findings, lab tests and maintenance records added
   -> follow-up readings reviewed
   -> incident resolved by a Water Quality Officer
```

Each step maps to a user flow. Compare this list with the user flows in section 12 and update it when the incident routes are registered.

## 9. AI-Assisted Explanations

The project requirements describe an AI/RAG workflow that can retrieve relevant evidence and generate an explanation to support investigation.

The complete retrieval path, approved-document handling, generated output validation, persistence, and failure handling must be verified before this is described as an operational part of the data pipeline.

An AI-generated explanation must not replace recorded measurements or independently change authoritative WQI, alert, or incident state.

### Intended retrieval path

1. Approved procedures are kept as markdown files in the repository. Images linked from those files are kept for reference only and are not sent to the model.
2. The files are uploaded to the Gemini Files API, and their identifiers, content hash and expiry are tracked in the `gemini_files` table.
3. When an alert needs an explanation, the backend builds a structured context: current and recent readings, WQI, node status and data-quality flags, readings from nearby nodes, and past incidents.
4. The backend sends the context and references to the approved files to the model and asks for a structured response.
5. The response is stored on the alert in `ai_explanation` with `ai_generated_at`.

### Intended output

The screen designs show an advisory explanation with four parts. A response shaped like the following would populate them:

```json
{
  "what_changed": "Turbidity went up over the last hour and is now above its limit.",
  "evidence_used": ["current readings", "recent trend", "node health", "nearby nodes", "approved procedures"],
  "still_to_confirm": "Whether the sensor is clean and calibrated.",
  "ideas_to_check": ["Compare nearby nodes", "Check calibration", "Consider a confirmation sample"],
  "disclaimer": "Advice only. This does not confirm a cause. Only lab tests can do that."
}
```

::: warning
The AI service receives structured context and approved documents only. It must not receive credentials, tokens or personal data, and its output is never used to change an alert, WQI or incident state.
:::

## 10. Location Data

Device records store the node's location: latitude and longitude, together with an address and name so the node is easy to recognise.

GPS provides latitude and longitude, not a human-readable address. Reverse geocoding can provide address information only where a suitable integration is configured and working. In the design, the backend sends the coordinates to LocationIQ and keeps the returned address with the device.

Missing coordinates, addresses, or device reports should be represented as unavailable data rather than replaced with invented values.

```text
Register node (name, serial number, latitude, longitude)
   -> POST /api/v1/devices
   -> reverse geocode coordinates (LocationIQ)
   -> store address with the device
```

## 11. Audit Logging

Sign-ins, failed sign-ins, account locks, user creation, role and status changes, and two-step verification changes are recorded so that an administrator can see who did what.

```python
# Illustrative helper: one place to write audit entries
def write_audit(db, *, user_id, action, entity_type=None, entity_id=None, ip=None, details=None):
    entry = AuditLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        ip_address=ip,
        details=redact(details),    # replace passwords, tokens and codes with [REDACTED]
    )
    db.add(entry)
```

A role change is stored with before and after values in the `details` column:

```json
{
  "before": { "role": "water_quality_officer" },
  "after":  { "role": "field_officer" }
}
```

Entries are read through `GET /audit-logs` and `GET /audit-logs/{audit_log_id}` and shown in the administrator's Audit log screens, which are read-only.

## 12. User Flows

The user flows complement the technical flow above by showing how people move through the system. The same images appear in the [System Overview](./index#_10-user-flows); you can reuse the files.


<a href="/User Flow - Water Quality Officer.jpg" target="_blank">
  <img src="/User Flow - Water Quality Officer.jpg" alt="AquaTrace secure architecture. Click to open full size." style="max-width: 100%; height: auto;" />
</a>


<a href="/User Flow - Admin  User flow.jpg" target="_blank">
  <img src="/User Flow - Admin  User flow.jpg" alt="AquaTrace secure architecture. Click to open full size." style="max-width: 100%; height: auto;" />
</a>


<a href="/User Flow - Field Officer.jpg" target="_blank">
  <img src="/User Flow - Field Officer.jpg" alt="AquaTrace secure architecture. Click to open full size." style="max-width: 100%; height: auto;" />
</a>
## 13. Research Report Reference

[Research Report](https://docs.google.com/document/d/1A1HebIQIDIkwSwNqf27scl0GQYZoty99H9ZT_4RbdD8/edit?usp=sharing).

Use the research findings to explain why traceable measurements, historical records, monitoring-location information, and documented operational responses matter. Keep research findings separate from proof that a particular technical feature has been implemented.

## 14. Verification Checklist

| Check | Status |
|---|---|
| Confirm the actual device-to-backend telemetry path | To verify |
| Verify the ingestion payload and validation rules | Service logic verified, schema file to link |
| Verify database persistence and duplicate handling | Duplicate handling verified in service, add test link |
| Check WQI calculation and classification tests | Add unit tests and link them |
| Confirm alert-triggering rules and incident transitions | To verify |
| Verify frontend API requests and error handling | To verify |
| Confirm the runtime status of external and AI integrations | To verify |
| Link tests or source files that support each implementation claim | In progress |

A starting point for the WQI tests that would close the third and fourth rows:

```python
import pytest
from services.sensor_reading_service import (
    normalize_ph, normalize_turbidity, assign_wqi_status,
)
from models.sensor_reading import WqiStatus

@pytest.mark.parametrize("ph,expected", [(7.0, 100.0), (6.0, 50.0), (9.0, 50.0), (5.0, 0.0)])
def test_normalize_ph(ph, expected):
    assert normalize_ph(ph) == pytest.approx(expected)

def test_turbidity_above_five_scores_zero():
    assert normalize_turbidity(6.8) == 0.0

@pytest.mark.parametrize("score,status", [
    (80, WqiStatus.EXCELLENT), (79, WqiStatus.GOOD), (51, WqiStatus.REGULAR),
    (36, WqiStatus.POOR), (19, WqiStatus.VERY_POOR),
])
def test_status_boundaries(score, status):
    assert assign_wqi_status(score) == status
```

::: tip
Adjust the import path to the real module that contains the WQI functions.
:::