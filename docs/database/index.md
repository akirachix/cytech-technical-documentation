# Database

The AquaTrace database brings together information about monitoring devices and their locations, water-quality readings, alerts, investigations, and maintenance activities. Keeping these records connected allows the team to trace a reported problem from the initial measurement through investigation and follow-up.

This page describes the data model. Its details should be checked against the SQLAlchemy models and Alembic migrations before being presented as the schema currently running in the application. The `Alert` and `AuditLog` models and the sensor-reading service logic are confirmed from source code and are marked **Verified**. SQL definitions on this page are written to match those models and the agreed data model; the authoritative definition is always the migration history.

### Status labels used on this page

| Label | Meaning |
|---|---|
| **Verified** | Confirmed from backend source code |
| **Designed** | From the agreed data model; confirm against the migrations |
| **Illustrative** | SQL or code that shows the intended definition; exact types and names may differ |

## 1. How the Data Is Organized

### 1.1 Users and Devices

**Users** stores account information, login credentials, account status, and assigned roles. The defined roles are Water quality officer, Field officer, and Admin. Authentication-related fields support one-time passwords, authenticator-app (TOTP) multi-factor authentication, recovery codes and account lockout.

**Devices** represents registered monitoring nodes, and each device carries its own location: latitude, longitude, name and address. A device can reference the device immediately upstream of it, which lets the system describe connections between monitoring points and compare a node with its neighbour. Coordinates must fall within valid geographic ranges. Each device records the user responsible for its registration, its serial number must be unique, and its status and timestamps describe its installation and lifecycle.

### 1.2 Measurements and Water Quality

**Sensor_Readings** stores validated measurements received from monitoring devices, including pH, temperature, turbidity, electrical conductivity, and the associated water quality index (WQI) score and status. Each reading retains the time reported by the device (`recorded_at`) and the time it was stored by the backend (`created_at`).

Message numbers are used with device identifiers to prevent the same device message from being processed as a new reading more than once. Only messages that pass validation become readings, so everything in this table is eligible for WQI calculation and alert evaluation.

**Rule_Versions, Thresholds, WQI_Weights and WQI_Bands** hold the rules used for assessment:

| Table | Holds |
|---|---|
| `rule_versions` | A named, versioned set of rules, with a flag marking the active one |
| `thresholds` | Minimum and maximum acceptable values per parameter and severity |
| `wqi_weights` | The weight of each parameter in the WQI calculation. The weights must total 100. |
| `wqi_bands` | Score ranges and labels for the WQI status bands |

Because rules are data, limits and weights can be reviewed against the applicable standard and changed without a code release.

### 1.3 Alerts and Incident Response

**Alerts** records conditions detected by the system, including threshold breaches, WQI changes, devices going offline, tampering, and sensor faults. Alert severity comes from defined rules rather than from the AI assistant. An alert may reference the reading that caused it, and it keeps the observed and threshold values as they were when the alert was raised. Repeated occurrences of the same open condition are grouped with `occurrence_count`.

**Incidents** records the investigation associated with an alert. It supports assignment to a Field officer, findings, corrective actions, verification, and closure. An alert can be associated with at most one incident.

**Maintenance_Records** tracks device calibration, cleaning, and repair. It can include the person who performed the work, relevant notes, maintenance status, and values recorded before and after maintenance.

**Lab_Tests** stores laboratory results associated with an incident. The record identifies the laboratory, tested parameter, result and unit, sample collection time, and testing time.

### 1.4 Accountability and Document References

**Audit_Logs** records important actions for traceability, including the responsible user when known, the affected entity, the source IP address, and supporting details. These records are append-only, meaning existing audit records cannot be edited or deleted through ordinary operations.

**Gemini_Files** tracks document references used with the Gemini Files API. It records the source document, content hash, file identifier, URI, status, and expiry times. Uploaded files expire after 48 hours, so expired references are refreshed while the source document is still required.

## 2. Conventions

| Convention | Rule |
|---|---|
| Primary keys | UUID, generated by the database or the application |
| Timestamps | `TIMESTAMPTZ`, stored in UTC |
| Names | `snake_case` for tables and columns, plural table names |
| Deletion | Foreign keys use `ON DELETE RESTRICT`. Users and devices are deactivated or revoked, never deleted. |
| Enumerations | PostgreSQL enum types for stable value sets, `CHECK` constraints for value ranges |
| Secrets | Passwords, TOTP secrets, recovery codes and OTPs are never stored in plain text |

## 3. Enumerated Types

```sql
CREATE TYPE user_role       AS ENUM ('water_quality_officer', 'field_officer', 'admin');
CREATE TYPE user_status     AS ENUM ('active', 'inactive');
CREATE TYPE device_status   AS ENUM ('active', 'inactive', 'revoked');
CREATE TYPE sensor_status   AS ENUM ('ok', 'fault');
CREATE TYPE alert_type      AS ENUM ('threshold_breach', 'wqi_change', 'device_offline', 'tamper', 'sensor_fault'); 
CREATE TYPE severity_level  AS ENUM ('warning', 'critical');                                       
CREATE TYPE alert_status    AS ENUM ('triggered', 'resolved');                                       
```

WQI status labels, in the order of the bands, are `Excellent`, `Good`, `Regular`, `Poor` and `Very Poor` (Verified from the service).

## 4. Table Definitions

### 4.1 users (Designed)

```sql
CREATE TABLE users (
  user_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name            VARCHAR(100) NOT NULL,
  last_name             VARCHAR(100) NOT NULL,
  email                 VARCHAR(255) NOT NULL,
  password_hash         TEXT NOT NULL,                 
  role                  user_role   NOT NULL,
  status                user_status NOT NULL DEFAULT 'active',

  mfa_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret           TEXT,                       
  recovery_code_hashes  TEXT[],                       
  otp_hash              TEXT,                        
  otp_expires_at        TIMESTAMPTZ,                
  otp_attempts          INTEGER NOT NULL DEFAULT 0,

  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_users_email_lower ON users (lower(email));
```

Notes:

- Email is unique regardless of letter case.
- The Users screen shows a person as **Locked** when `locked_until` is in the future, separately from Active or Inactive.
- Two-step verification shows as On when `mfa_enabled` is true.

### 4.2 devices (Designed)

```sql
CREATE TABLE devices (
  device_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number      VARCHAR(50) NOT NULL UNIQUE,
  name               VARCHAR(100),
  description        TEXT,
  address            TEXT,                                 
  latitude           DOUBLE PRECISION NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude          DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  upstream_device_id UUID REFERENCES devices(device_id) ON DELETE RESTRICT,
  registered_by      UUID REFERENCES users(user_id)     ON DELETE RESTRICT,
  status             device_status NOT NULL DEFAULT 'active',
  installed_at       TIMESTAMPTZ,
  last_seen_at       TIMESTAMPTZ,
  last_calibrated_at TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_devices_not_own_upstream CHECK (upstream_device_id IS NULL OR upstream_device_id <> device_id),
  CONSTRAINT ck_devices_revoked_at CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
```

Notes:

- GPS provides coordinates only. The address is added by reverse geocoding and may be empty until that succeeds.
- The `upstream_device_id` link supports comparing a node with the one before it, which the AI assistant uses as evidence.

### 4.3 sensor_readings (Verified from the ingestion service, Designed for constraints)

```sql
CREATE TABLE sensor_readings (
  reading_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id                UUID NOT NULL REFERENCES devices(device_id) ON DELETE RESTRICT,
  message_number           BIGINT NOT NULL,
  ph                       DOUBLE PRECISION CHECK (ph BETWEEN 0 AND 14),
  temperature              DOUBLE PRECISION,
  turbidity                DOUBLE PRECISION CHECK (turbidity >= 0),
  electrical_conductivity  DOUBLE PRECISION CHECK (electrical_conductivity >= 0),
  wqi_score                DOUBLE PRECISION CHECK (wqi_score BETWEEN 0 AND 100),
  wqi_status               VARCHAR(20),
  sensor_status            sensor_status NOT NULL,
  is_buffered              BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_at              TIMESTAMPTZ NOT NULL,              -- device time
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(), -- backend time
  CONSTRAINT ux_readings_device_message UNIQUE (device_id, message_number),
  CONSTRAINT ck_readings_wqi_pair CHECK ((wqi_score IS NULL) = (wqi_status IS NULL))
);
```

Notes:

- The unique pair (`device_id`, `message_number`) is what makes ingestion idempotent.
- `wqi_score` and `wqi_status` are both empty when the sensor status is not OK or when the weights are incomplete. The `ck_readings_wqi_pair` check keeps the two in step, so a reading can never have a status without a score.
- `is_buffered` is true when the reading arrived more than 300 seconds after `recorded_at`.

The service builds each row from this dictionary (Verified):

```python
reading_data = {
    "device_id": device_uuid,
    "message_number": payload.message_number,
    "ph": payload.ph,
    "temperature": payload.temperature,
    "turbidity": payload.turbidity,
    "electrical_conductivity": payload.electrical_conductivity,
    "wqi_score": wqi_score,
    "wqi_status": wqi_status,
    "sensor_status": payload.sensor_status,
    "is_buffered": is_buffered,
    "recorded_at": payload.recorded_at,
}
```

### 4.4 Assessment rules: rule_versions, thresholds, wqi_weights, wqi_bands (Designed)

```sql
CREATE TABLE rule_versions (
  rule_version_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number        INTEGER NOT NULL UNIQUE,
  wqi_method_description TEXT,
  change_note           TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT FALSE,
  created_by            UUID REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_rule_versions_one_active ON rule_versions (is_active) WHERE is_active;

CREATE TABLE thresholds (
  threshold_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_version_id UUID NOT NULL REFERENCES rule_versions(rule_version_id) ON DELETE RESTRICT,
  parameter       VARCHAR(30) NOT NULL
                  CHECK (parameter IN ('ph','temperature','turbidity','electrical_conductivity')),
  severity        severity_level NOT NULL,
  min_value       DOUBLE PRECISION,
  max_value       DOUBLE PRECISION,
  CONSTRAINT ck_thresholds_bounds CHECK (min_value IS NOT NULL OR max_value IS NOT NULL),
  CONSTRAINT ck_thresholds_order  CHECK (min_value IS NULL OR max_value IS NULL OR min_value < max_value),
  UNIQUE (rule_version_id, parameter, severity)
);

CREATE TABLE wqi_weights (
  wqi_weight_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_version_id UUID NOT NULL REFERENCES rule_versions(rule_version_id) ON DELETE RESTRICT,
  parameter       VARCHAR(30) NOT NULL
                  CHECK (parameter IN ('ph','temperature','turbidity','electrical_conductivity')),
  weight          DOUBLE PRECISION NOT NULL CHECK (weight > 0 AND weight <= 100),
  UNIQUE (rule_version_id, parameter)
);

CREATE TABLE wqi_bands (
  wqi_band_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_version_id UUID NOT NULL REFERENCES rule_versions(rule_version_id) ON DELETE RESTRICT,
  label           VARCHAR(20) NOT NULL,
  min_score       DOUBLE PRECISION NOT NULL,
  max_score       DOUBLE PRECISION NOT NULL,
  CHECK (min_score < max_score)
);
```

Weights are stored as percentages and the service divides each by 100 (Verified):

```python
def fetch_active_weights(db: Session) -> dict[str, float]:
    records = db.query(WqiWeight).all()
    return {record.parameter: record.weight / 100.0 for record in records}
```

A check that the weights of one rule version total 100 is easiest to run when the rules are saved, because a table constraint cannot see other rows:

```sql
SELECT SUM(weight) FROM wqi_weights WHERE rule_version_id = :rule_version_id;
```

### 4.5 alerts (Verified)

The model below is taken directly from the backend.

```python
class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        CheckConstraint(
            "parameter IN ('ph', 'temperature', 'turbidity', 'electrical_conductivity')",
            name="ck_alerts_parameter",
        ),
    )

    alert_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.device_id", ondelete="RESTRICT"),
                       nullable=False, index=True)
    reading_id = Column(UUID(as_uuid=True), ForeignKey("sensor_readings.reading_id", ondelete="RESTRICT"),
                        nullable=True)

    alert_type = Column(Enum(AlertType, name="alert_type"), nullable=False)
    parameter = Column(String(30), nullable=True)
    observed_value = Column(Float, nullable=True)
    threshold_value = Column(Float, nullable=True)

    severity = Column(Enum(SeverityLevel, name="severity_level"), nullable=False)
    message = Column(Text, nullable=False)

    status = Column(Enum(AlertStatus, name="alert_status"), nullable=False, default=AlertStatus.TRIGGERED)
    occurrence_count = Column(Integer, nullable=False, default=1, server_default="1")
    ai_explanation = Column(Text, nullable=True)
    ai_generated_at = Column(DateTime(timezone=True), nullable=True)
    seen_at = Column(DateTime(timezone=True), nullable=True)
    officers_notified_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    device = relationship("Device", back_populates="alerts")
    reading = relationship("SensorReading", back_populates="alerts")
    incident = relationship("Incident", back_populates="alert", uselist=False)
```

The equivalent SQL, with the index that supports grouping repeats:

```sql
CREATE TABLE alerts (
  alert_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id            UUID NOT NULL REFERENCES devices(device_id) ON DELETE RESTRICT,
  reading_id           UUID REFERENCES sensor_readings(reading_id) ON DELETE RESTRICT,
  alert_type           alert_type NOT NULL,
  parameter            VARCHAR(30)
                       CHECK (parameter IN ('ph','temperature','turbidity','electrical_conductivity')),
  observed_value       DOUBLE PRECISION,
  threshold_value      DOUBLE PRECISION,
  severity             severity_level NOT NULL,
  message              TEXT NOT NULL,
  status               alert_status NOT NULL DEFAULT 'triggered',
  occurrence_count     INTEGER NOT NULL DEFAULT 1,
  ai_explanation       TEXT,
  ai_generated_at      TIMESTAMPTZ,
  seen_at              TIMESTAMPTZ,
  officers_notified_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_alerts_one_open
  ON alerts (device_id, alert_type, COALESCE(parameter, ''))
  WHERE status = 'triggered';
```

::: warning
The model shown has a `location_name` property that reads the device's location. Because location now lives on the device, make sure that property reads the device's own `name` or `address`.
:::

How the columns map to the screens:

| Screen element | Column |
|---|---|
| New and Seen filters | `seen_at` is empty or set |
| "3 similar alerts grouped" | `occurrence_count` |
| Severity filters (High, Medium, Low) | `severity`, together with the parameter and how far the value is from its limit |
| "Current 6.8 NTU, threshold 5.0 NTU" | `observed_value`, `threshold_value` |
| Advisory explanation | `ai_explanation`, `ai_generated_at` |

### 4.6 incidents (Designed)

```sql
CREATE TABLE incidents (
  incident_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id          UUID NOT NULL UNIQUE REFERENCES alerts(alert_id) ON DELETE RESTRICT,  
  assigned_to       UUID REFERENCES users(user_id) ON DELETE RESTRICT,                   
  resolved_by       UUID REFERENCES users(user_id) ON DELETE RESTRICT,                   
  findings          TEXT,
  corrective_action TEXT,
  visited_at        TIMESTAMPTZ,
  priority          VARCHAR(20),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  CONSTRAINT ck_incidents_resolved CHECK ((resolved_by IS NULL) = (resolved_at IS NULL))
);
```

The UNIQUE constraint on `alert_id` enforces the one-incident-per-alert rule.

The five stages on the incident screen can be derived from the columns, which avoids a status value that could drift out of step:

| Stage | Reached when |
|---|---|
| Created | The row exists |
| Assigned | `assigned_to` is set |
| Investigating | `visited_at` is set |
| Follow up | `findings` and `corrective_action` are recorded |
| Resolved | `resolved_at` and `resolved_by` are set |

### 4.7 maintenance_records (Designed)

```sql
CREATE TABLE maintenance_records (
  maintenance_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id        UUID NOT NULL REFERENCES devices(device_id)   ON DELETE RESTRICT,
  performed_by     UUID NOT NULL REFERENCES users(user_id)       ON DELETE RESTRICT,
  incident_id      UUID REFERENCES incidents(incident_id)        ON DELETE RESTRICT,  
  maintenance_type VARCHAR(30) NOT NULL,     
  status           VARCHAR(20),
  value_before     TEXT,
  value_after      TEXT,
  performed_at     TIMESTAMPTZ NOT NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The Nodes screen lists these records as "Calibration and maintenance", for example "Cleaned turbidity sensor", "Calibrated pH sensor" and "Replaced EC probe".

### 4.8 lab_tests (Designed)

```sql
CREATE TABLE lab_tests (
  lab_test_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id         UUID NOT NULL REFERENCES incidents(incident_id) ON DELETE RESTRICT,
  recorded_by         UUID NOT NULL REFERENCES users(user_id)         ON DELETE RESTRICT,
  laboratory_name     VARCHAR(150) NOT NULL,
  parameter           VARCHAR(50)  NOT NULL,
  result_value        DOUBLE PRECISION NOT NULL,
  unit                VARCHAR(20)  NOT NULL,
  sample_collected_at TIMESTAMPTZ NOT NULL,
  tested_at           TIMESTAMPTZ NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tested_at >= sample_collected_at)
);
```

Laboratory results are the only evidence that can confirm a cause. They are kept separate from sensor readings.

### 4.9 audit_logs (Verified)

```python
class AuditLog(Base):
    __tablename__ = "audit_logs"

    audit_log_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True)
    action = Column(String(50), nullable=False)
    entity_type = Column(String(50), nullable=True)
    entity_id = Column(UUID(as_uuid=True), nullable=True)
    ip_address = Column(INET, nullable=True)
    details = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="audit_logs")
```

`user_id` is optional because failed sign-ins for an unknown email have no user. The audit screens then show "Unknown email" and "(no user)".

#### Append-only enforcement (Illustrative)

The model alone does not stop someone from editing the table. Enforce the rule in the database with triggers and permissions:

```sql
CREATE OR REPLACE FUNCTION audit_logs_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_change();

CREATE TRIGGER trg_audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_change();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM aquatrace_app;
GRANT  INSERT, SELECT             ON audit_logs TO   aquatrace_app;
```

#### Common actions and detail payloads

| Action | `entity_type` | `details` example |
|---|---|---|
| `login_success`, `login_failed` | `user` or empty | `{"email": "<attempted email>"}` for unknown users |
| `account_locked` | `user` | `{"failed_attempts": 5}` |
| `user_created` | `user` | `{"role": "field_officer"}` |
| `user_role_changed` | `user` | `{"before": {"role": "water_quality_officer"}, "after": {"role": "field_officer"}}` |
| `user_status_changed` | `user` | `{"before": {"status": "active"}, "after": {"status": "inactive"}}` |
| `mfa_enabled` | `user` | `{}` |

A password, token, OTP or authenticator code must never appear in `details`. Anything of that kind is replaced with `[REDACTED]` before the row is written.

### 4.10 gemini_files (Designed)

```sql
CREATE TABLE gemini_files (
  gemini_file_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document  VARCHAR(255) NOT NULL,        
  content_hash     CHAR(64)     NOT NULL,        
  mime_type        VARCHAR(100) NOT NULL,
  gemini_file_name VARCHAR(255) NOT NULL,        
  gemini_file_uri  TEXT         NOT NULL,
  status           VARCHAR(20)  NOT NULL,        
  uploaded_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ  NOT NULL        
);

CREATE UNIQUE INDEX ux_gemini_files_active_doc ON gemini_files (source_document) WHERE status = 'active';
```

A file is usable only while `status = 'active'` and `expires_at` is in the future. See [AI-Assisted Analysis](../ai/) for the refresh process.

## 5. Relationships and Data Integrity

The relationships between these records are important to the reliability of AquaTrace. A device can have multiple validated readings, alerts, and maintenance records. The upstream reference connects devices into a monitoring network.

An alert belongs to a device and may refer to a specific reading. An incident records the investigation of an alert, while maintenance and laboratory records can provide additional evidence during that investigation. User references identify who registered a device, received an assignment, performed maintenance, or recorded a laboratory result.

| From | To | Cardinality | On delete |
|---|---|---|---|
| `devices.upstream_device_id` | `devices` | many to one, optional | RESTRICT |
| `devices.registered_by` | `users` | many to one | RESTRICT |
| `sensor_readings.device_id` | `devices` | many to one | RESTRICT |
| `alerts.device_id` | `devices` | many to one | RESTRICT |
| `alerts.reading_id` | `sensor_readings` | many to one, optional | RESTRICT |
| `incidents.alert_id` | `alerts` | one to one (unique) | RESTRICT |
| `incidents.assigned_to`, `resolved_by` | `users` | many to one, optional | RESTRICT |
| `maintenance_records.device_id` | `devices` | many to one | RESTRICT |
| `maintenance_records.performed_by` | `users` | many to one | RESTRICT |
| `maintenance_records.incident_id` | `incidents` | many to one, optional | RESTRICT |
| `lab_tests.incident_id` | `incidents` | many to one | RESTRICT |
| `lab_tests.recorded_by` | `users` | many to one | RESTRICT |
| `audit_logs.user_id` | `users` | many to one, optional | RESTRICT |
| `thresholds`, `wqi_weights`, `wqi_bands` | `rule_versions` | many to one | RESTRICT |
| `rule_versions.created_by` | `users` | many to one | RESTRICT |

Foreign keys, unique constraints, valid ranges, and required fields help protect these relationships. The backend must also validate incoming device messages before accepting them as trusted readings.

### Integrity rules at a glance

| Rule | Enforced by |
|---|---|
| A device message is stored once | `UNIQUE (device_id, message_number)` |
| Serial numbers are unique | `UNIQUE (serial_number)` |
| Coordinates are valid | `CHECK` on latitude and longitude |
| pH is between 0 and 14, turbidity and EC are not negative | `CHECK` constraints and service validation |
| A reading never has a WQI status without a score | `CHECK ((wqi_score IS NULL) = (wqi_status IS NULL))` |
| An alert has at most one incident | `UNIQUE (alert_id)` on `incidents` |
| Only one open alert per device, type and parameter | Partial unique index |
| Only one active rule version | Partial unique index |
| Revoked devices carry a revocation time | `CHECK` on `devices` |
| Audit entries cannot change | Triggers and revoked privileges |
| Accounts and devices are never hard-deleted | `ON DELETE RESTRICT` and no delete routes |

## 6. Indexes

```sql
CREATE INDEX ix_readings_device_recorded ON sensor_readings (device_id, recorded_at DESC);

CREATE INDEX ix_alerts_created ON alerts (created_at DESC);
CREATE INDEX ix_alerts_unseen  ON alerts (created_at DESC) WHERE seen_at IS NULL;

CREATE INDEX ix_audit_created ON audit_logs (created_at DESC);
CREATE INDEX ix_audit_user    ON audit_logs (user_id, created_at DESC);
CREATE INDEX ix_audit_action  ON audit_logs (action, created_at DESC);

CREATE INDEX ix_incidents_assigned ON incidents (assigned_to) WHERE resolved_at IS NULL;
CREATE INDEX ix_maintenance_device ON maintenance_records (device_id, performed_at DESC);
```

## 7. Database Roles and Row Level Security (Designed)

The design uses least-privilege database access and Row Level Security (RLS) so that a leaked client key cannot read tables directly.

```sql
CREATE ROLE aquatrace_app LOGIN PASSWORD '<set from a secret>';

GRANT USAGE ON SCHEMA public TO aquatrace_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO aquatrace_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM aquatrace_app;       -- records are never deleted
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM aquatrace_app;      -- append-only

ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_readings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs       ENABLE ROW LEVEL SECURITY;


CREATE POLICY app_all ON users FOR ALL TO aquatrace_app USING (true) WITH CHECK (true);
```

::: tip
Repeat the `ENABLE ROW LEVEL SECURITY` and policy pair for every table. A table with RLS enabled and no matching policy returns no rows to that role.
:::

The password for `aquatrace_app` is set from a secret and never written in a migration.

## 8. Seed and Reference Data

Rules need to exist before the first reading arrives. Weights below are examples only. Replace them, and the limits, with values approved against the applicable Kenyan drinking-water standard.

```sql
INSERT INTO rule_versions (version_number, wqi_method_description, change_note, is_active)
VALUES (1, 'Weighted sum of normalised sub-scores', 'Initial provisional rules', TRUE)
RETURNING rule_version_id;

INSERT INTO wqi_weights (rule_version_id, parameter, weight) VALUES
  (:rv, 'ph',                      30),
  (:rv, 'turbidity',               30),
  (:rv, 'electrical_conductivity', 25),
  (:rv, 'temperature',             15);

INSERT INTO wqi_bands (rule_version_id, label, min_score, max_score) VALUES
  (:rv, 'Very Poor',  0, 19),
  (:rv, 'Poor',      19, 36),
  (:rv, 'Regular',   36, 51),
  (:rv, 'Good',      51, 79),
  (:rv, 'Excellent', 79, 100);
```

## 9. Migrations

Schema changes go through reviewed Alembic migrations.

```bash
alembic revision --autogenerate -m "add audit log triggers"
alembic upgrade head
alembic downgrade -1
```

Alembic autogenerate does not detect triggers, functions, partial indexes or role grants, so write those by hand in the migration:

```python
def upgrade():
    op.execute("""
        CREATE OR REPLACE FUNCTION audit_logs_block_change() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_audit_logs_no_update_delete
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION audit_logs_block_change();
    """)
    op.create_index(
        "ux_alerts_one_open", "alerts",
        ["device_id", "alert_type", sa.text("COALESCE(parameter, '')")],
        unique=True, postgresql_where=sa.text("status = 'triggered'"),
    )

def downgrade():
    op.drop_index("ux_alerts_one_open", table_name="alerts")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_logs_no_update_delete ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS audit_logs_block_change()")
```

Rules for migrations:

- One logical change per migration, with a clear message.
- Read every autogenerated file before applying it.
- Test `upgrade` and `downgrade` against a copy of production data before releasing.
- Never edit a migration that has already been applied elsewhere. Add a new one.

## 10. Common Queries

Latest reading for each device (what the dashboard shows):

```sql
SELECT DISTINCT ON (device_id) *
FROM sensor_readings
ORDER BY device_id, recorded_at DESC;
```

Seven-day trend of the score for one device:

```sql
SELECT date_trunc('day', recorded_at) AS day,
       round(avg(wqi_score)::numeric, 1) AS avg_wqi
FROM sensor_readings
WHERE device_id = :device_id
  AND wqi_score IS NOT NULL
  AND recorded_at >= now() - interval '7 days'
GROUP BY 1 ORDER BY 1;
```

Open alerts that nobody has seen, most serious first:

```sql
SELECT alert_id, device_id, severity, parameter, occurrence_count, created_at
FROM alerts
WHERE status = 'triggered' AND seen_at IS NULL
ORDER BY (severity = 'critical') DESC, created_at DESC;
```

Evidence an officer or the AI assistant needs for one alert: the node, the node upstream of it, and past incidents on the same node.

```sql
SELECT d.device_id, d.name, d.status, d.last_seen_at, r.*
FROM alerts a
JOIN devices d ON d.device_id = a.device_id
LEFT JOIN LATERAL (
  SELECT * FROM sensor_readings s
  WHERE s.device_id = d.device_id
  ORDER BY recorded_at DESC LIMIT 1
) r ON TRUE
WHERE a.alert_id = :alert_id;

SELECT s.*
FROM devices d
JOIN sensor_readings s ON s.device_id = d.upstream_device_id
WHERE d.device_id = :device_id
ORDER BY s.recorded_at DESC LIMIT 1;

SELECT i.incident_id, i.findings, i.corrective_action, i.resolved_at
FROM incidents i
JOIN alerts a ON a.alert_id = i.alert_id
WHERE a.device_id = :device_id AND i.resolved_at IS NOT NULL
ORDER BY i.resolved_at DESC LIMIT 5;
```

Audit log with the screen's filters:

```sql
SELECT *
FROM audit_logs
WHERE (:action  IS NULL OR action = :action)
  AND (:user_id IS NULL OR user_id = :user_id)
  AND created_at BETWEEN :from AND :to
ORDER BY created_at DESC
LIMIT 25 OFFSET :offset;
```

## 11. Retention and Backups

| Topic | Approach |
|---|---|
| Backups | Automated backups on Supabase. A restore is tested before go-live and after major changes. |
| Retention of readings | Keep full-resolution readings for a defined period, then consider downsampling. The period must be set by the operations team. |
| Audit log | Keep for the period required by the organisation's policy. Entries are not deleted by the application. |
| Gemini file references | Expired rows can be marked `expired`. They are not evidence. |

## 12. Items to Confirm

Before finalizing the database documentation, compare the data model with the current code and migrations, especially:

- The `rule_version_id` on weights, thresholds and bands. The sensor-reading service reads every row in `wqi_weights` without filtering by rule version, so confirm whether versioning is applied when readings are scored.
- The incident `priority` values and the maintenance `status` values and before and after fields, which are not fully specified.
- Whether the `registered_by` and `upstream_device_id` columns exist on devices in the deployed schema.
- The exact stored strings for `wqi_status` and `sensor_status`.
- Whether the `ck_readings_wqi_pair` check, the partial indexes and the audit triggers have been applied by a migration.
- The database roles and Row Level Security policies actually configured in Supabase.

These are verification points, not assumptions that the implementation is incorrect.

## 13. Entity-Relationship Diagram

The diagram should show the main entities, their primary and foreign keys, relationship cardinality, optional references, and deletion behaviour. Click the image or the expand icon to open it full screen.


## 14. Related Documentation

- [System Overview](../overview/)
- [Data Flow](../overview/data-flow)
- [Backend API](../backend/)
- [WQI](../wqi/)
- [AI-Assisted Analysis](../ai/)
- [Security](../security/)
- [Operations](../operations/)