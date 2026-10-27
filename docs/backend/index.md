# Backend Documentation

## 1. Overview

AquaTrace uses a Python backend built with FastAPI. The backend provides authentication, user management, water quality monitoring, sensor data access, alerts, incidents, laboratory test records, maintenance records, audit logs, and water quality index configuration.

The backend is organized around API routers, service classes, repositories, database models, security dependencies, and application settings.

The following sections describe the implementation evidenced by the supplied source code. Where the exact implementation of a component was not provided, this document does not assume additional behavior.

## 2. Backend Architecture

The backend separates HTTP request handling from business logic and database access.

| Component | Responsibility |
|---|---|
| Routers | Define API endpoints, request parameters, authentication requirements, and response handling |
| Dependencies | Authenticate users and enforce role requirements |
| Services | Implement application operations such as authentication and audit event recording |
| Repositories | Provide database query and persistence operations |
| Models | Represent database entities and relationships |
| Configuration | Load database, token, email, CORS, and integration settings |
| Migrations | Define database schema changes and constraints |

A typical request follows this sequence:

1. The client sends an HTTP request to a router.
2. FastAPI resolves the endpoint's dependencies.
3. Authentication and authorization checks run where required.
4. The router or service uses a repository to access data.
5. The backend returns the response.

## 3. API Routers

### 3.1 Authentication endpoints

The authentication router provides login, token refresh, password reset, password change, and multi-factor authentication operations.

| Method | Endpoint | Purpose | Access control evidenced in the supplied code |
|---|---|---|---|
| POST | `/auth/login` | Authenticate a user | Public endpoint with rate limiting |
| POST | `/auth/refresh` | Refresh authentication tokens | No route-level authentication decorator was visible in the supplied excerpt |
| POST | `/auth/forgot-password` | Request a password reset | Public endpoint with rate limiting |
| POST | `/auth/reset-password` | Reset a password | Public endpoint with rate limiting |
| POST | `/auth/change-password` | Change the current user's password | Authenticated user |
| POST | `/auth/verify-mfa` | Verify MFA during authentication | Public endpoint with rate limiting |
| POST | `/auth/mfa/setup` | Begin MFA setup | Authenticated user |
| POST | `/auth/mfa/setup/verify` | Verify MFA setup | MFA setup token dependency |
| POST | `/auth/mfa/disable` | Disable MFA | Authenticated user |

The supplied router uses rate limits on sensitive operations. The visible limits include 10 requests per minute for login and 5 requests per minute for password reset, MFA verification, MFA setup, and MFA disable operations.

The following example illustrates the authentication dependency pattern. It is a representative excerpt based on the supplied implementation, not a replacement for the complete router source.

<details>
<summary>View authentication dependency example</summary>

```python
from fastapi import Depends, HTTPException, status

def require_authenticated_user(
    current_user=Depends(get_current_user),
):
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return current_user
```

</details>

The actual endpoint should use the project's existing `get_current_user` dependency rather than introducing a duplicate authentication implementation.

### 3.2 User management endpoints

The user router provides self-service profile operations and administrative user management.

| Method | Endpoint | Purpose | Authorization |
|---|---|---|---|
| GET | `/users/me` | Retrieve the current user's profile | Authenticated user |
| PATCH | `/users/me` | Update the current user's profile | Authenticated user |
| GET | `/users` | List users | Administrator |
| POST | `/users` | Create a user | Administrator |
| GET | `/users/{user_id}` | Retrieve a user by ID | Administrator |
| PATCH | `/users/{user_id}` | Update a user by ID | Administrator |
| POST | `/users/{user_id}/deactivate` | Deactivate a user | Administrator |
| POST | `/users/{user_id}/activate` | Activate a user | Administrator |
| POST | `/users/{user_id}/reset-password` | Reset a user's password | Administrator |
| POST | `/admin/register` | Register an administrator | No route-level authentication dependency was visible in the supplied excerpt |

The user listing endpoint supports pagination and an optional status filter. The visible parameter constraints are:

- `limit`: default 50, minimum 1, maximum 100.
- `offset`: default 0, minimum 0.
- `status`: optional status enum.

The pagination parameters can be declared as follows:

<details>
<summary>View pagination parameter example</summary>

```python
from typing import Annotated
from fastapi import Query

limit: Annotated[int, Query(ge=1, le=100)] = 50
offset: Annotated[int, Query(ge=0)] = 0
```

</details>

This excerpt illustrates the documented constraints. It is not the complete endpoint implementation.

**Security consideration:** `/admin/register` should be reviewed carefully because the supplied route excerpt did not show a route-level authorization dependency. The service may enforce additional restrictions, but that behavior cannot be confirmed from the router excerpt alone.

## 4. Authentication and Authorization

### 4.1 Current-user authentication

The `get_current_user` dependency validates the access token and resolves the associated user.

The supplied implementation checks that:

- The token contains the required `sub`, `iat`, `exp`, and `iss` claims.
- The token is an access token.
- The subject can be parsed as a UUID.
- The corresponding user exists.
- The user is active.

A simplified illustration of this flow is shown below.

<details>
<summary>View current-user validation flow</summary>

```python
from uuid import UUID
from fastapi import HTTPException, status

def resolve_active_user(payload, user_repository):
    subject = payload.get("sub")

    if payload.get("token_use", "access") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    try:
        user_id = UUID(subject)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
        )

    user = user_repository.get_by_id(user_id)

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User unavailable",
        )

    return user
```

</details>

This example isolates the user resolution checks. The production dependency also handles token decoding and required claim validation. The supplied project implementation remains authoritative.

### 4.2 Role-based authorization

Two role dependencies are evidenced in the supplied code:

- `require_admin`: allows users with the `ADMIN` role.
- `require_water_quality_officer`: allows users with the `WATER_QUALITY_OFFICER` role.

Administrative endpoints use the administrator dependency to restrict access.

For example, the route declaration can use the existing dependency:

```python
@router.get("/users")
def list_users(
    current_user=Depends(require_admin),
):
    ...
```

The ellipsis represents omitted endpoint logic. It is not intended to be copied as a complete implementation.

### 4.3 MFA setup tokens

MFA setup uses a separate dependency, `get_current_user_for_mfa_setup`. It requires the token's `token_use` claim to equal `mfa_setup` and checks that the user is active and has not already enabled MFA.

This separates the permission to complete MFA setup from ordinary access-token authentication.

## 5. JWT and Password Security

### 5.1 JWT configuration

The supplied security implementation uses RS256 signing and verification keys. Key material can be supplied through settings or key file paths.

The configured token claims include:

- `sub`: user identifier.
- `iat`: issue time.
- `exp`: expiration time.
- `iss`: token issuer.
- `token_use`: token purpose.

Access token and refresh token lifetimes are configurable. MFA-related tokens have short lifetimes, with the supplied code using five-minute and ten-minute expiration periods for different MFA flows.

### 5.2 Token creation example

The following example illustrates the shape of a signed JWT payload. The actual signing implementation should use AquaTrace's existing security functions and configured RSA keys.

<details>
<summary>View JWT payload example</summary>

```python
from datetime import datetime, timezone

def build_access_token_claims(user_id, issuer):
    now = datetime.now(timezone.utc)

    return {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int(now.timestamp()) + 1800,
        "iss": issuer,
        "token_use": "access",
    }
```

</details>

The 30-minute lifetime in this illustration is an example only. AquaTrace obtains the actual access-token lifetime from configuration. The example does not sign a token.

### 5.3 Password handling

The security implementation uses `PasswordHash.recommended` for password hashing and verification.

The authentication service also implements:

- A maximum of five failed login attempts.
- A 15-minute login lock period.
- Generic invalid-email and invalid-password responses.
- Password reset OTPs with a ten-minute validity period.
- A maximum of five password reset attempts.
- Verification of the current password before changing it.

The supplied code uses a cryptographically secure random generator to create six-digit password reset OTPs. The stored OTP is hashed rather than retained as plaintext.

### 5.4 Refresh token considerations

The refresh token implementation includes a `jti` claim generated using `secrets.token_urlsafe(32)`.

The supplied excerpts do not establish whether refresh-token identifiers are persisted, invalidated, or checked for replay. These behaviors should not be documented as implemented without inspecting the complete refresh-token flow.

## 6. Multi-Factor Authentication

AquaTrace's authentication service uses TOTP-based MFA. The supplied code also includes encrypted TOTP secret storage and hashed recovery codes.

The evidenced behavior includes:

- Initiating MFA setup for an authenticated user.
- Verifying MFA setup with a dedicated setup token.
- Verifying MFA during authentication.
- Disabling MFA for an authenticated user.
- Supporting recovery codes that are intended for one-time use.

### MFA setup flow

1. An authenticated user requests MFA setup.
2. The backend prepares the MFA setup flow.
3. The user verifies the setup using the dedicated MFA setup token.
4. The backend checks the verification result before enabling MFA.

The complete MFA setup response format and TOTP generation details should be taken from the actual service and schema definitions. They are not reproduced here because the supplied excerpts do not establish the full response contract.

## 7. Database Models and Constraints

The supplied migration defines constraints for several AquaTrace entities.

| Entity | Evidenced constraints |
|---|---|
| Users | Unique email; nonnegative counters; MFA enabled requires a TOTP secret |
| Audit logs | User foreign key uses `RESTRICT` on deletion |
| Devices | Unique serial number |
| Sensor readings | pH range from 0 to 14; unique device and message-number combination |
| Alerts | Database constraints and foreign-key relationships |
| Incidents | Unique alert association |
| Laboratory tests | Test time must not precede sample collection time |
| Locations | Latitude and longitude range checks |
| Gemini file metadata | Expiration constraint and partial uniqueness for active documents per source document |

### 7.1 Sensor reading integrity

The migration enforces a pH range and prevents duplicate message numbers for the same device.

A simplified representation of the constraints is:

<details>
<summary>View sensor reading constraint example</summary>

```sql
CHECK (ph >= 0 AND ph <= 14),
UNIQUE (device_id, message_number)
```

</details>

This illustrates the reported constraints. Column names and types should be verified against the complete migration before using the snippet in a migration file.

The repository supports lookup by device and message number, creation with a flush, listing, and retrieval of the latest reading for each device.

### 7.2 Laboratory test integrity

The migration enforces chronological consistency between sample collection and testing.

```sql
CHECK (tested_at >= sample_collected_at)
```

This prevents a record from representing a test time earlier than its sample collection time.

### 7.3 Location integrity

The migration applies latitude and longitude range checks to location records. These checks protect the database from coordinates outside the valid geographic ranges.

## 8. Repository Layer

Repositories centralize database access for the backend's domain entities.

The supplied code includes repositories for:

- Alerts.
- Audit logs.
- Devices.
- Incidents.
- Laboratory tests.
- Maintenance.
- Sensor readings.
- Users.
- Water quality index weights.

### 8.1 Sensor reading repository

The sensor reading repository provides operations to locate an existing reading using its device and message number, create readings, list readings, and retrieve the latest reading for each device.

A simplified repository interface might look like this:

<details>
<summary>View repository interface example</summary>

```python
class SensorReadingRepository:
    def get_by_device_and_message_number(
        self,
        device_id,
        message_number,
    ):
        ...

    def create(self, reading):
        ...

    def list_readings(self, device_id=None):
        ...

    def get_latest_by_device(self):
        ...
```

</details>

This is an interface illustration, not a verbatim copy of the repository. The ellipses indicate omitted method bodies.

### 8.2 Alert repository

The alert repository supports filtering and updating alerts. It also includes logic for identifying critical alerts that have not yet been notified.

The existence of this query supports the notification workflow's data selection logic. It does not, by itself, establish delivery guarantees, retries, or exactly-once notification behavior.

### 8.3 Incident repository

The incident repository supports filtering incident records. The database migration also enforces a unique association between an incident and its alert.

### 8.4 Water quality index weights

The WQI weights repository can optionally acquire a database row lock using `FOR UPDATE`. This allows the repository to support serialized access to the relevant row when the calling transaction requests it.

The exact transaction boundaries and concurrency guarantees depend on how the service uses this repository.

## 9. Audit Logging

### 9.1 Audit event creation

The audit service rejects an empty action before creating an audit record through the repository.

The audit model includes fields for:

- Action.
- Entity type and entity identifier.
- Associated user.
- IP address.
- JSONB details.
- Creation timestamp.

A simplified illustration of the service's validation is:

```python
def validate_audit_action(action):
    if not action:
        raise ValueError("Audit action cannot be empty")
```

This snippet illustrates the validation rule only. It does not replace the full audit service.

### 9.2 Audit log endpoints

| Method | Endpoint | Purpose | Authorization |
|---|---|---|---|
| GET | `/audit-logs` | List audit records | Administrator |
| GET | `/audit-logs/{audit_log_id}` | Retrieve an audit record | Administrator |

The list endpoint supports a limit between 1 and 100, an offset greater than or equal to zero, and optional user and action filters.

### 9.3 Audit limitations

The supplied code establishes that an audit service and administrator-protected audit endpoints exist. It does not establish that every sensitive operation records an event, that records are immutable, or that tampering is detectable.

Those properties should be verified against the full set of service calls, database permissions, and operational controls.

## 10. Application Configuration

The application settings include configuration for database connectivity, CORS, JWT keys, token lifetimes, OAuth, MFA encryption, location services, GPS integrations, and SMTP.

| Setting | Evidenced behavior |
|---|---|
| `database_url` | Required database connection setting |
| `frontend_origin` | Frontend origin setting |
| `cors_origins` | Allowed CORS origins |
| JWT key settings | Private and public key values or file paths |
| Access token lifetime | Default 30 minutes, constrained to 1 through 1440 minutes |
| Refresh token lifetime | Default 1 day, constrained to 1 through 90 days |
| Issuer and audience | Default value `aquatrace-api` |
| `mfa_encryption_key` | MFA secret encryption configuration |
| LocationIQ and GPS settings | External location integration configuration |
| SMTP settings | Email configuration, with TLS enabled by default |

The supplied defaults for JWT key paths are `secrets/jwt-private.pem` and `secrets/jwt-public.pem`. Deployments should ensure that production keys are provisioned securely and are not committed to source control.

## 11. CI and Deployment

### 11.1 Continuous integration

The supplied CI workflow runs on a self-hosted runner labelled `classroom-ci`.

It configures a SQLite database URL for the test environment, supplies a test-only JWT secret, installs the project's Python dependencies, and runs pytest with coverage reporting.

The workflow command includes:

<details>
<summary>View CI test command</summary>

```bash
uv run --no-sync pytest --cov --cov-report=term-missing
```

</details>

The supplied workflow also uses Ruff to check code quality and formatting in the pull request checks.

The existence of these workflow steps does not establish that the tests currently pass. A successful workflow run is needed to confirm that.

### 11.2 Deployment workflow

The deployment workflow targets Heroku and runs after the CI prerequisite succeeds. It checks for the required Heroku configuration, uploads the source through the Heroku Platform API, waits for the build to complete, and then checks the configured application health endpoint.

The health check targets:

```text
${HEROKU_APP_URL%/}/health
```

The workflow retries the health check rather than assuming that a successful build means the deployed application is ready.

## 12. Backend Testing

The supplied tests cover several authentication and user management behaviors, including:

- Successful login.
- Login with an incorrect password.
- User creation and authentication.
- Password change.
- Password change with an incorrect current password.
- Weak password rejection.
- Rejection of unauthenticated password changes.

The supplied workflow runs pytest with coverage reporting. No test execution results were provided, so this document does not claim that the current test suite passes or that any specific coverage threshold has been achieved.

## 13. Areas Requiring Further Verification

The following behaviors cannot be fully confirmed from the supplied excerpts:

1. Whether `/admin/register` has authorization checks inside its service.
2. Whether refresh tokens are persisted, revoked, or checked for replay.
3. Whether every security-sensitive action is recorded in the audit log.
4. Whether alert notification delivery has retry or deduplication guarantees.
5. The complete request and response schemas for all endpoints.
6. The full service-level transaction behavior for repositories that support row locking.
7. The exact AI integration flow, including model calls, prompts, retrieval, and failure handling.
8. The current outcome of CI, deployment, and test coverage.

These items should be confirmed from the corresponding implementation and runtime evidence before the documentation describes them as guaranteed behavior.

## 14. Summary

The AquaTrace backend uses FastAPI routers, authentication dependencies, service classes, repositories, database constraints, and deployment automation to support water quality monitoring and related administrative workflows.

The supplied implementation provides evidence for role-based access control, JWT validation, password reset controls, MFA, repository-level data access, audit log retrieval, database integrity constraints, and automated testing and deployment steps.

This documentation intentionally distinguishes evidenced behavior from illustrative code and unverified assumptions. For exact function signatures and copy-ready implementation examples, the original source files should be used as the authoritative reference.