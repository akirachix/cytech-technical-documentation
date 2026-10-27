# System Architecture

## 1. Overview

AquaTrace separates the web frontend, backend API, database, and monitoring integrations. Each component has a distinct responsibility, allowing authorised users to access monitoring information without the frontend connecting directly to the database or physical devices.

The application repositories are maintained separately:

- [Frontend repository](https://github.com/akirachix/cytech-frontend)
- [Backend repository](https://github.com/akirachix/cytech-backend)

## 2. High-Level Architecture Diagram

The System Architecture Diagram (SAD) shows the frontend, backend API, PostgreSQL database, monitoring devices, telemetry integration, and external services. Click the image or the expand icon to open it full screen and zoom in.

<a href="/aquatrace-sad.png" target="_blank">
  <img src="/aquatrace-sad.png" alt="AquaTrace architecture. Click to open full size." style="max-width: 100%; height: auto;" />
</a>

### Reading the diagram

| Area of the diagram | What it represents |
|---|---|
| Users and PWA | Water Quality Officers, Field Officers and the System Administrator using the web application |
| Modules (Node Readings, Alert, Incident Management, Reports and History, User and account management) | The functional areas of the backend API that the application calls |
| AquaTrace API and AquaTrace Database | The FastAPI backend and its PostgreSQL store |
| Node.js IoT API, Subscriber and HiveMQ | The telemetry path that receives device messages |
| Remote gateway network and ESP32 with sensors | The field hardware: temperature, turbidity, electrical conductivity and pH sensors plus a GPS module |
| Markdown files, images folder and Gemini Files API | The approved documents used for AI-assisted explanations |
| LocationIQ API | Reverse geocoding of node coordinates |

## 3. Main Components

### 3.1 Web Frontend

The web application uses Next.js, React, and TypeScript and is hosted on Vercel.

It presents monitoring information and user workflows, including device registration and selection, water-quality readings, and maintenance records. The frontend obtains application data through backend API clients.

A typical API client call looks like this. The variable names are illustrative; take the real ones from the frontend repository.

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function getLatestReadings(accessToken: string) {
  const res = await fetch(`${API_URL}/sensor-readings/latest`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }
  return res.json();
}
```

### 3.2 Backend API

The backend uses Python and FastAPI to expose HTTP endpoints and is hosted on Heroku.

The technology stack includes Pydantic for data validation, SQLAlchemy for database access, and Alembic for database migrations.

The agreed route groups cover authentication, users, devices, sensor readings, alerts, maintenance records, laboratory tests and audit logs. The availability of other domains, including incidents, must be checked against the active application's registered routes.

You can list the routes a running application has actually registered with a short script:

```python
from main import app

for route in app.routes:
    methods = ",".join(sorted(getattr(route, "methods", []) or []))
    print(f"{methods:12} {route.path}")
```

### 3.3 Database

PostgreSQL, hosted on Supabase, stores structured application records. SQLAlchemy provides the database access layer, while Alembic tracks schema changes through migrations.

The current models and migrations in the backend repository are the primary sources for documenting the actual database structure.

The main tables are:

| Table | Purpose |
|---|---|
| `users` | Accounts, roles, password hash, MFA state and lockout counters |
| `devices` | Monitoring nodes with serial number, coordinates, address and lifecycle timestamps |
| `sensor_readings` | Measurements with WQI score and status, `message_number` and `is_buffered` |
| `wqi_weights` | Weight per parameter used in the WQI calculation |
| `alerts` | Operational signals with severity, grouping count, and optional AI explanation |
| `incidents` | Investigations created from alerts |
| `lab_tests` | Laboratory results attached to incidents |
| `maintenance_records` | Calibration, cleaning and replacement history per device |
| `audit_logs` | Append-only record of sign-ins and account changes |
| `gemini_files` | Tracking of approved documents uploaded for AI-assisted explanations |

See [Database](../database/) for columns, constraints and relationships.

### 3.4 Monitoring Devices and Telemetry

Monitoring devices are intended to collect water-quality measurements and provide device information.

According to the architecture diagram, an ESP32 reads temperature, turbidity, electrical conductivity and pH sensors and a GPS module (NEO-6M). It sends readings through a cellular gateway to a HiveMQ broker over MQTT with TLS on port 8883. A Node.js subscriber receives the messages and passes the readings to the platform.

Two details differ between the diagrams and must be settled from the code before they are described as fact:

- The SAD shows the Node.js IoT API saving node readings directly to the database, while the secure SAD shows the backend subscribing to HiveMQ topics and receiving validated telemetry.
- The backend already contains an ingestion service behind `POST /sensor-readings/` that validates the device, enforces idempotency and computes the WQI.

The exact telemetry transport, message broker, Node.js integration, authentication, and end-to-end data path must be verified against the relevant implementation. Their inclusion in the intended design does not establish that the complete integration is operational.

### 3.5 Location Services

Each device record stores its geographic coordinates and a human-readable address and name, so a node can be identified in lists and on maps without a separate lookup.

GPS provides latitude and longitude, not a human-readable street address. Address enrichment requires separate descriptive data or the LocationIQ reverse-geocoding service. The LocationIQ API key is held as a secret and is never exposed to the browser.

### 3.6 Water Quality Index

The backend contains WQI functionality that runs when a sensor reading is ingested. Each parameter is normalised to a 0 to 100 score, multiplied by its weight and summed, and the result is mapped to a status band.

```python
scores = {
    "ph": normalize_ph(payload.ph),
    "temperature": normalize_temperature(payload.temperature),
    "turbidity": normalize_turbidity(payload.turbidity),
    "electrical_conductivity": normalize_ec(payload.electrical_conductivity),
}
wqi_score = round(sum(scores[name] * weights[name] for name in PARAMETERS), 2)
wqi_status = assign_wqi_status(wqi_score)
```

Weights come from the `wqi_weights` table and are stored as percentages, so the service divides them by 100. Weights, limits and band boundaries are provisional until confirmed against the applicable standard. The full method is in [WQI](../wqi/).

### 3.7 Operational Workflows

The broader AquaTrace requirements include maintenance, laboratory testing, alerts, and incident investigation.

Routes for maintenance records, laboratory tests and alerts are in the agreed route list. The actual state transitions and role permissions must be confirmed against the active backend code and tests.

### 3.8 AI-Assisted Decision Support

The project requirements describe an AI/RAG capability intended to explain monitoring evidence and support investigation.

In the design, approved markdown documents (for example the Water Safety Plan and the incident procedure) are uploaded to the Gemini Files API. An alert request sends structured context and references to those files to a Gemini model, and the result is stored with the alert. Images linked from the markdown files stay in the repository for reference and are not sent to the model.

The complete retrieval, generation, validation, and persistence workflow must be verified before it is described as fully implemented.

## 4. Backend Layers

The backend follows a router, service and repository layout. The sensor reading code shows the pattern: the service imports repository functions and applies the business rules.

```text
HTTP request
   |
Router         validates input with Pydantic schemas, applies auth dependencies
   |
Service        business rules (idempotency, WQI, buffered flag)
   |
Repository     database queries through SQLAlchemy
   |
PostgreSQL
```

```python
from repositories.sensor_reading_repository import (
    get_reading_by_device_and_message,
    create_reading,
    get_readings,
    get_reading_by_id,
    get_latest_reading_per_device,
    get_readings_by_device,
)
```

Errors are translated to HTTP responses in the service layer with `HTTPException`, so the router stays thin.

## 5. Logical Request Flow

A typical web request follows these steps:

1. A user interacts with the frontend.
2. The frontend calls the relevant backend API.
3. FastAPI routes the request to the appropriate endpoint.
4. The backend validates the request and enforces authorization.
5. Application logic retrieves or updates data through the database access layer.
6. The backend returns an HTTP response.
7. The frontend displays the result or an appropriate loading, empty, or error state.

Device telemetry may follow a separate integration path. Its exact sequence must be documented from the actual implementation. See [Data Flow](./data-flow).

## 6. Security Architecture

The Secure System Architecture Diagram shows the security controls around each part of the system. Use it together with the SAD above.

<a href="/aquatrace-secure-sad.png" target="_blank">
  <img src="/aquatrace-secure-sad.png" alt="AquaTrace secure architecture. Click to open full size." style="max-width: 100%; height: auto;" />
</a>

### Security zones

| Zone | Contents | Main controls |
|---|---|---|
| Users | Water Quality Officer, Field Officer, Administrator | Individual accounts only |
| Secure access | HTTPS and TLS entry to the system | Email and password sign-in, password policy (minimum 8 characters, a number and a special character), MFA with authenticator app or email code, rate limiting, bcrypt password hashing, JWT session with refresh token |
| AquaTrace backend security boundary | API gateway and services: RBAC, input validation, incident service, dashboard service, RAG service, audit logging | Role checks, request validation, audit trail |
| Protected data and device layer | ESP32 nodes, device identity, device authorization, message validation, HiveMQ broker, Supabase PostgreSQL | MQTT over TLS, per-device identity, encrypted database, Row Level Security, least-privilege roles, automated backups |
| External services | Gemini API, LocationIQ, secret management | Structured context only to Gemini, keys held in secrets, TLS, timeouts |

### Cross-cutting controls

| Control | Detail |
|---|---|
| Encryption in transit | HTTPS with TLS 1.2 or later, MQTT over TLS |
| Encryption at rest | Managed by Supabase |
| Least privilege | RBAC in the API and Row Level Security in the database |
| Monitoring | Supabase logs, Sentry and UptimeRobot |
| Backups | Supabase automated backups with a restore test before go-live |
| Patching | GitHub Dependabot and `pip-audit` |
| Security testing | Semgrep in CI through GitHub Actions |
| Incident response | Runbook, audit logs and key rotation |

### Password and session handling

Passwords are hashed with bcrypt and never stored or logged in plain text. A minimal illustration of the approach:

```python
import bcrypt

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
```

The audit log model records who did what, from where, and against which entity:

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
```

More detail is in [Security](../security/).

## 7. Hosting and Environments

| Unit | Platform |
|---|---|
| Frontend (Next.js) | Vercel |
| Backend API (FastAPI) | Heroku |
| Database | Supabase PostgreSQL |
| MQTT broker | HiveMQ |
| Secrets | Host environment variables (Heroku, Vercel) and GitHub Secrets. No secrets in code. |

See [Deployment](../deployment/) for configuration.

## 8. Architectural Boundaries

- The frontend must not connect directly to PostgreSQL.
- The backend must enforce authorization independently of frontend restrictions.
- Business logic should follow the backend's established service-layer conventions.
- Database schema changes should be managed through reviewed Alembic migrations.
- Raw sensor measurements must remain distinguishable from calculated WQI results.
- AI-generated explanations must not be treated as authoritative measurements.
- External integrations should be documented as implemented only after their runtime behaviour has been verified.

## 9. Failure Modes

| Situation | Intended behaviour |
|---|---|
| Reading sent for an unknown device | Rejected with `404`; the device must be registered first |
| Same reading delivered twice | The existing reading is returned and no duplicate is stored |
| Reading older than 5 minutes when received | Stored and flagged `is_buffered` |
| Sensor reports a fault | Stored without a WQI score |
| Value outside the valid range | Rejected with `422` |
| AI service unavailable | The alert still exists; only the explanation is missing |
| Geocoding unavailable | The device keeps its coordinates; the address can be added later |
| Account locked after failed sign-ins | Sign-in is refused until the lock expires or an administrator unlocks the account |

## 10. Research Report and Design Evidence

[Research Report](https://docs.google.com/document/d/1A1HebIQIDIkwSwNqf27scl0GQYZoty99H9ZT_4RbdD8/edit?usp=sharing).

The research report should explain the problem being addressed, research questions, methodology, findings and implications for system design.

Research findings should be connected to technical decisions where appropriate. For example, findings about data traceability or delays in operational response may help explain the need for historical readings, monitoring-location information, and incident records.

The report's findings must be distinguished from implementation evidence. A research recommendation does not establish that a corresponding feature has already been implemented.

## 11. Implementation Verification

Use the following sources to keep this page accurate:

- Frontend page components and API clients
- FastAPI application setup and router registrations
- Backend services and database-access modules
- SQLAlchemy models and Alembic migrations
- OpenAPI schemas and automated tests
- Device and external-service integration code
- Approved research and product requirements

Update this page as integrations and features are verified. Keep planned and unverified behaviour clearly identified.