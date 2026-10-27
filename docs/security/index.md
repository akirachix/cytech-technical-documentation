# AquaTrace Security and Testing

## 1. Overview

AquaTrace is a water quality monitoring and incident management system. Its backend uses FastAPI, SQLAlchemy, and database migrations to manage application data and provide authentication, authorization, sensor monitoring, alerts, incidents, and related functionality.

AquaTrace's security implementation includes password hashing, signed JSON Web Tokens (JWTs), role-based authorization, account lockout, multi-factor authentication (MFA), password reset controls, database integrity constraints, and audit-log storage.

The testing approach includes backend automated tests with pytest, API testing with Postman, browser-based testing with Playwright, test cases, and automated checks through CI/CD workflows.

This document describes the supplied implementation and the testing methods identified for the project. It distinguishes verified source-code behavior from test scenarios that require execution evidence.

## 2. Authentication and Authorization

### 2.1 Password handling

AquaTrace uses `PasswordHash.recommended()` from `core/security.py` to hash and verify passwords. The authentication service verifies submitted passwords during login and hashes new passwords during password changes and resets.

The user model stores the password hash in `password_hash` rather than storing a plaintext password.

Relevant files:

- `core/security.py`
- `services/auth_service.py`
- `models/user.py`

### 2.2 Login and account lockout

The authentication service defines the following controls:

| Control | Value in the supplied implementation |
|---|---:|
| Failed login attempts before lockout | 5 |
| Account lockout duration | 15 minutes |
| Password reset OTP lifetime | 10 minutes |
| Maximum password reset attempts | 5 |

The login service uses a generic `Invalid email or password` response for invalid credentials and inactive accounts. Failed attempts for existing active accounts are counted, and the account is locked after the configured threshold is reached. The failed-login counter is reset following successful authentication.

These controls help limit repeated authentication attempts. Their effectiveness also depends on how the application is configured and deployed.

### 2.3 JWT access and refresh tokens

AquaTrace signs and verifies JWTs using RS256. Signing and verification keys can be provided through settings or loaded from configured key files.

The supplied implementation includes:

- Configurable access-token expiration, defaulting to 30 minutes.
- Configurable refresh-token expiration, defaulting to one day.
- Issuer validation using `jwt_issuer`, which defaults to `aquatrace-api`.
- Subject, issued-at, and expiration claims.
- A `token_use` claim to distinguish token purposes.
- A generated `jti` claim on refresh tokens.

The `get_current_user` dependency in `dependencies.py` validates the bearer token, checks required claims, verifies that the token is an access token, loads the associated user, and rejects missing or inactive accounts.

<details>
<summary>View an example JWT payload</summary>

```json
{
  "sub": "user-uuid",
  "iat": 1760000000,
  "exp": 1760001800,
  "iss": "aquatrace-api",
  "token_use": "access"
}
```

</details>

The values above are illustrative and are not a real token. The supplied code does not establish that refresh-token identifiers are persisted, revoked, or checked for reuse. Refresh-token revocation and replay prevention must not be assumed.

Relevant files:

- `core/security.py`
- `services/auth_service.py`
- `dependencies.py`

### 2.4 Role-based authorization

AquaTrace defines the following roles:

- `ADMIN`
- `WATER_QUALITY_OFFICER`
- `FIELD_OFFICER`

The supplied dependencies include:

| Dependency | Purpose |
|---|---|
| `get_current_user` | Resolves an authenticated active user |
| `get_current_user_for_mfa_setup` | Validates the MFA setup token and associated user state |
| `require_admin` | Restricts access to administrators |
| `require_water_quality_officer` | Restricts access to Water Quality Officers |

The role dependencies return HTTP 403 when an authenticated user does not have the required role.

### 2.5 User management access

The supplied `/users` router applies `require_admin` to user listing, creation, retrieval by ID, updates, activation, deactivation, and administrator-triggered password resets.

The `/users/me` endpoints require authentication and operate on the current user's account.

**Route requiring further verification:** `POST /admin/register` does not show a route-level authentication dependency in the supplied excerpt. Its protection may be implemented inside `UserService.register_admin` or elsewhere in the application. It should not be described as administrator-only until that behavior is verified.

## 3. Password Recovery and Multi-Factor Authentication

### 3.1 Password reset

The authentication service generates a six-digit password reset one-time password (OTP) using Python's `secrets` module. The OTP is stored as a password hash and expires after ten minutes. The service limits attempts and clears OTP state after a successful reset.

The service also handles email-delivery failures by logging the exception and clearing OTP state.

The supplied router shows these rate limits:

| Endpoint | Rate limit shown |
|---|---:|
| `POST /auth/forgot-password` | 5 requests per minute |
| `POST /auth/reset-password` | 5 requests per minute |
| `POST /auth/login` | 10 requests per minute |
| `POST /auth/verify-mfa` | 5 requests per minute |
| `POST /auth/mfa/setup` | 5 requests per minute |
| `POST /auth/mfa/setup/verify` | 5 requests per minute |
| `POST /auth/mfa/disable` | 5 requests per minute |

No route-level rate-limit decorator was visible on `POST /auth/refresh` in the supplied excerpt. A global limiter may exist, but this has not been established by the available evidence.

### 3.2 Password changes

`POST /auth/change-password` requires the `get_current_user` dependency. The service verifies the current password before hashing and saving the new password.

The supplied test source covers successful password changes, rejection of an incorrect current password, weak-password validation, and rejection of unauthenticated requests.

### 3.3 Multi-factor authentication

AquaTrace supports time-based one-time passwords (TOTP). The supplied implementation includes:

- Short-lived MFA challenge tokens.
- Short-lived MFA setup tokens.
- An encrypted TOTP secret.
- Hashed recovery codes.
- One-time recovery code use.
- MFA disablement requiring password verification and a valid TOTP or recovery code.
- MFA challenge expiration and validation.

The user model stores MFA state, the TOTP secret, recovery-code hashes, and MFA challenge state. The database defines a constraint requiring a TOTP secret when MFA is enabled.

Relevant files:

- `services/auth_service.py`
- `core/security.py`
- `dependencies.py`
- `models/user.py`
- Initial Alembic migration

The presence of an encryption-key setting does not establish that production key material is securely provisioned or rotated. These operational controls require separate verification.

## 4. Audit Logging and Database Safeguards

### 4.1 Audit logging

The `AuditLog` model records:

- Optional user ID.
- Action.
- Optional entity type and entity ID.
- Optional client IP address.
- Optional JSONB details.
- Creation timestamp.

`AuditService.record_event` rejects an empty action and creates an audit record through `AuditLogRepository`.

The audit-log API provides:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/audit-logs` | List and filter audit records |
| GET | `/audit-logs/{audit_log_id}` | Retrieve a single audit record |

Both supplied routes require `require_admin`. The list endpoint supports pagination and optional user and action filters.

The audit-log table uses a foreign key to `users` with `ON DELETE RESTRICT`. This prevents deletion of a referenced user while the reference remains in place.

The supplied code does not establish that every sensitive operation is audited or that audit records are tamper-proof. Those properties require additional code and infrastructure review.

### 4.2 Database integrity

The supplied models and initial Alembic migration define constraints for several entities.

| Data area | Evidenced safeguard |
|---|---|
| Users | Unique email and nonnegative counters |
| MFA | MFA-enabled users must have a TOTP secret |
| Devices | Unique serial number |
| Sensor readings | Unique `(device_id, message_number)` pair and pH range check |
| Alerts | Parameter checks and foreign-key relationships |
| Incidents | Unique alert association |
| Laboratory tests | Test time cannot precede sample collection time |
| Locations | Latitude and longitude range checks |
| Gemini file records | Expiration constraint and partial unique index for active documents per source document |

For example, the supplied migration enforces a valid pH range and prevents duplicate message numbers for the same device.

<details>
<summary>View sensor reading constraints</summary>

```sql
CHECK (ph >= 0 AND ph <= 14),
UNIQUE (device_id, message_number)
```

</details>

This snippet illustrates the reported constraints. Verify the complete migration before using it as a standalone SQL statement.

These database safeguards help maintain data consistency. They do not replace endpoint authorization, application validation, database access controls, or operational monitoring.

## 5. Security Configuration

The application settings include configuration for:

- `DATABASE_URL`
- Frontend origin and CORS origins
- JWT signing and verification keys
- JWT issuer and token lifetimes
- MFA encryption key
- SMTP configuration
- Location services and external integration API keys

The default JWT key paths are `secrets/jwt-private.pem` and `secrets/jwt-public.pem`. The settings also default `smtp_use_tls` to `True`.

These settings establish available configuration options, not proof that production secrets and connections are securely configured. Production deployments should provide secrets through the deployment platform's secret configuration and avoid committing credentials or private keys to source control.

## 6. Testing Overview

AquaTrace uses several testing methods to validate different parts of the application.

| Method | Main purpose |
|---|---|
| pytest | Backend automated tests |
| Postman | API request and response validation |
| Playwright | Browser-based end-to-end testing |
| Test cases | Structured verification of expected behavior |
| GitHub Actions | Automated checks during development and deployment |

Each method serves a different purpose. Backend tests can verify service and data behavior, Postman can validate API contracts and authorization, and Playwright can validate complete browser workflows.

The existence of a test script or test case does not establish that it passes. Test results should be recorded from actual executions.

## 7. Backend Testing with pytest

### 7.1 Existing test coverage

The supplied test source covers the following behaviors:

| Area | Evidenced test cases |
|---|---|
| Login | Successful login and incorrect password |
| User authentication | User creation and authentication |
| Password change | Successful password change |
| Password verification | Rejection of an incorrect current password |
| Password validation | Weak password rejection |
| Authentication requirements | Rejection of unauthenticated password change requests |

These tests provide evidence of coverage for core authentication and account management behavior. They do not establish comprehensive coverage of all routers, services, repositories, or security controls.

### 7.2 Running backend tests

The supplied CI workflow uses `uv` to run pytest with coverage reporting.

<details>
<summary>View the backend test command</summary>

```bash
uv run --no-sync pytest --cov --cov-report=term-missing
```

</details>

This command executes the test suite, collects coverage, and prints a report showing lines that are missing coverage.

The supplied workflow installs project dependencies, including the development dependency group, before running tests.

```bash
uv pip install -r pyproject.toml --group dev
```

These are the commands shown in the supplied workflow. Local execution depends on having the expected Python environment and dependencies configured.

### 7.3 Recommended backend test areas

Additional test cases should verify:

- Expired, malformed, and incorrectly signed JWTs.
- Missing or invalid token claims.
- Inactive user authentication.
- Role-based access denial.
- Account lockout after repeated failed login attempts.
- Password reset OTP expiration and attempt limits.
- MFA setup, verification, disablement, and recovery code reuse.
- Refresh-token expiration and reuse behavior.
- Database constraints and duplicate sensor readings.
- Audit event creation for required sensitive operations.

These are recommended areas for verification. They should not be interpreted as existing tests unless confirmed in the test suite.

## 8. API Testing with Postman

Postman is used as part of AquaTrace's testing approach to exercise API endpoints and inspect their responses.

API testing can verify that endpoints return the expected status codes and response data, enforce authentication, reject invalid input, and apply role-based access restrictions.

### 8.1 Suggested API test coverage

| Area | Suggested test scenarios |
|---|---|
| Authentication | Valid login, invalid credentials, inactive account |
| Token validation | Missing token, malformed token, expired token |
| User management | Profile access, profile updates, administrator-only operations |
| Password recovery | Valid and invalid reset OTP, expired OTP, attempt limit |
| MFA | Valid and invalid verification, setup flow, recovery code behavior |
| Sensor readings | Valid reading, invalid pH, duplicate device message number |
| Audit logs | Authorized access, unauthorized access, filtering and pagination |
| Alerts and incidents | Valid requests, invalid identifiers, access restrictions |

The exact requests and expected results should match AquaTrace's API schemas and implemented behavior.

### 8.2 Postman collection organization

A practical collection can group requests by functionality:

- Authentication
- User management
- Sensor readings
- Alerts and incidents
- Laboratory tests
- Audit logs

Use Postman environment variables for values such as the API base URL and test tokens, rather than embedding environment-specific values throughout the collection.

<details>
<summary>View a generic Postman test script</summary>

```javascript
pm.test("Response status is successful", function () {
    pm.expect(pm.response.code).to.be.within(200, 299);
});
```

</details>

This is an illustrative Postman assertion. It is not evidence of an existing AquaTrace script, and it should only be used for requests where a successful 2xx response is the expected result.

For negative tests, assert the specific status code and response behavior expected by the endpoint. For authentication tests, ensure that tokens and credentials belong to a test environment.

### 8.3 Recording Postman results

For reproducible API testing, record:

- Collection and request name.
- Environment used.
- Preconditions and test data.
- Expected status code and response.
- Actual status code and response.
- Pass or fail result.
- Date of execution and relevant defect reference.

The supplied context does not include the actual Postman collection, environment configuration, or execution report. Exact collection names and test results should be added once those artifacts are available.

## 9. End-to-End Testing with Playwright

Playwright supports browser-based testing of application workflows. In AquaTrace, it can be used to validate the interaction between the user interface and the backend.

### 9.1 Suggested end-to-end scenarios

| Workflow | Suggested validation |
|---|---|
| Login | User can sign in with valid credentials and receives an appropriate error for invalid credentials |
| Authenticated navigation | Protected pages are inaccessible without the required authentication |
| User profile | The current user can view and update permitted profile fields |
| MFA | Setup and verification screens behave according to the implemented flow |
| Water quality monitoring | Sensor readings and related information render correctly |
| Alerts and incidents | Authorized users can view and interact with the permitted records |
| Administrative workflows | Restricted user-management functions are available only to authorized roles |
| Error handling | Loading, empty, validation, and server-error states are handled appropriately |

These scenarios are recommendations for documenting the testing approach. The actual Playwright test files are needed to confirm which scenarios are currently automated.

### 9.2 Example Playwright test

The following is an illustrative browser test using Playwright's Python API. It is not a copy of an existing AquaTrace test and assumes that the login page and selectors match the application.

<details>
<summary>View a Playwright login test example</summary>

```python
import os
from playwright.sync_api import Page, expect

def test_login_page_loads(page: Page):
    base_url = os.environ["AQUATRACE_BASE_URL"]
    page.goto(f"{base_url}/login")
    expect(page).to_have_url(f"{base_url}/login")
```

</details>

The URL path should be adjusted to match the actual frontend routing. The base URL is read from an environment variable so that test environments can be configured without changing the test code.

### 9.3 Playwright test reporting

For useful and reproducible results, record:

- Test name and workflow.
- Browser and execution environment.
- Preconditions and test data.
- Expected and actual outcomes.
- Pass or fail status.
- Screenshots, traces, or logs when a test fails.

The supplied context does not include the Playwright configuration, test files, browser matrix, or execution reports. These details should be documented from the actual project artifacts.

## 10. Test Cases and Validation

Test cases provide a consistent way to specify what is being verified and how success is determined.

A test case should include:

| Field | Description |
|---|---|
| Test ID | Unique identifier |
| Test name | Short description of the behavior |
| Objective | What the test verifies |
| Preconditions | Required user state, data, and environment |
| Test steps | Actions performed |
| Expected result | Required system behavior |
| Actual result | Observed behavior during execution |
| Status | Pass, fail, blocked, or not run |
| Evidence | Test output, response, screenshot, or report |

### 10.1 Example test case

| Field | Example |
|---|---|
| Test ID | AUTH-001 |
| Test name | Login with invalid credentials |
| Objective | Verify that invalid credentials are rejected |
| Preconditions | Test environment is available |
| Test steps | Submit an invalid email and password combination |
| Expected result | Authentication is rejected with the expected error response |
| Actual result | Fill in after execution |
| Status | Not run until verified |
| Evidence | Postman response, pytest output, or test report |

This is a proposed test case format. It does not represent a recorded test execution.

### 10.2 Mapping test cases to tools

| Test category | Suitable tools |
|---|---|
| Service logic and validation | pytest |
| API status codes and response contracts | Postman or pytest |
| Browser navigation and user workflows | Playwright |
| Database integrity | pytest and database-level assertions |
| Security authorization | pytest, Postman, and selected Playwright workflows |
| Build and deployment verification | GitHub Actions |

Some scenarios benefit from more than one layer of testing. For example, an authorization rule can be verified through a backend test and an API request, while Playwright can confirm that the interface responds appropriately to the resulting access denial.

## 11. CI/CD Verification

### 11.1 Continuous integration

The supplied `.github/workflows/ci.yml` workflow runs on a self-hosted runner labelled `classroom-ci`.

It configures `DATABASE_URL: sqlite://` and a test-only JWT secret, sets up the Python version from `.python-version`, installs `uv`, installs the project's development dependencies, and runs pytest with coverage reporting.

The pull request workflow also includes Ruff linting and formatting checks.

<details>
<summary>View Ruff validation commands</summary>

```bash
ruff check .
ruff format --check .
```

</details>

The lint command checks code quality. The format command checks formatting without applying changes.

The supplied workflow does not establish whether Postman collections or Playwright tests are executed automatically in CI. That should be confirmed by reviewing the workflow files and test scripts.

### 11.2 Deployment verification

The supplied Heroku deployment workflow depends on CI completing successfully. It uploads the application source, waits for the Heroku build to succeed, and then checks the configured application's `/health` endpoint with retries.

The health check URL is constructed as follows:

```bash
"${HEROKU_APP_URL%/}/health"
```

This confirms that the deployment workflow includes a health check. It does not establish that every endpoint, database operation, external integration, or browser workflow works correctly in production.

### 11.3 Test results and coverage

The supplied CI command generates a terminal coverage report with missing-line information. No execution logs, measured coverage percentage, Postman report, or Playwright report were supplied.

Consequently, this document does not claim that the test suite passes or that a specific coverage threshold has been achieved.

For each verified run, record the workflow or collection name, execution status, test totals, failures, and coverage results where available.

## 12. Security Verification Matrix

The following matrix connects security requirements with appropriate verification methods.

| Security requirement | Suggested verification method | Evidence to record |
|---|---|---|
| Passwords are hashed and verified | pytest | Password verification assertions |
| Invalid credentials are rejected | pytest or Postman | Expected response and test result |
| Inactive users cannot authenticate | pytest or Postman | Authentication rejection |
| Protected endpoints reject unauthenticated requests | pytest, Postman, or Playwright | Expected authorization response |
| Administrator-only endpoints enforce role checks | pytest or Postman | Results for authorized and unauthorized roles |
| Password reset OTPs expire and enforce attempt limits | pytest or Postman | Expiration and attempt-limit assertions |
| MFA verification follows the expected flow | pytest or Postman | Valid and invalid verification results |
| Recovery codes cannot be reused after successful use | pytest | Recovery code state assertions |
| Sensor reading constraints reject invalid data | pytest or API tests | Validation and database assertions |
| Required sensitive operations create audit records | pytest or database assertions | Audit record evidence |
| Browser workflows respect access restrictions | Playwright | Test report and failure evidence |
| Deployed application responds to health checks | CI/CD workflow | Deployment health-check result |

This matrix defines verification targets. The listed tools are recommendations for each requirement, not proof that all corresponding tests are already implemented.

## 13. Recommended Additional Verification

The following areas deserve further testing based on the supplied security implementation and testing setup.

### Authentication and authorization

1. Verify expired and malformed JWT handling.
2. Test inactive-user rejection.
3. Test all role restrictions for administrative and water quality operations.
4. Verify password reset OTP expiration and attempt limits.
5. Test MFA setup, verification, disablement, and recovery code reuse.
6. Review refresh-token invalidation and replay behavior.
7. Verify the access restrictions around `POST /admin/register`.

### API and browser workflows

1. Confirm Postman tests cover positive and negative API scenarios.
2. Confirm Playwright tests cover the most important user journeys.
3. Verify validation and error states in the frontend.
4. Test behavior when the backend or an external integration is unavailable.
5. Record actual results and link failures to defects where applicable.

### Database and audit behavior

1. Test duplicate sensor message numbers.
2. Test invalid pH values and geographic coordinates.
3. Verify laboratory timestamp constraints.
4. Confirm required sensitive operations generate audit records.
5. Test audit endpoint filtering, pagination, and authorization.
6. Verify transaction and concurrency behavior where repository locking is used.

### CI/CD integration

1. Confirm which pytest, Postman, and Playwright suites run automatically.
2. Ensure test credentials and secrets are isolated from production.
3. Record coverage and test outcomes from actual workflow runs.
4. Verify deployment health checks and investigate failed checks.
5. Document any test suites that must be run manually.

## 14. Summary

AquaTrace implements application-level security controls including password hashing, RS256 JWTs, role-based authorization, account lockout, MFA, password reset protections, database integrity constraints, and administrator-only audit-log access.

Its testing approach combines pytest for backend behavior, Postman for API validation, Playwright for browser workflows, structured test cases, and CI/CD checks for code quality, test execution, and deployment health.

The supplied source confirms several backend controls and the pytest and Ruff workflow configuration. The actual Postman collections, Playwright test files, complete test case records, and execution reports were not included in the supplied evidence. Those artifacts should be used to document exact coverage and verified results.

Security implementation, test design, and successful test execution are separate forms of evidence. Keeping these distinctions clear makes the AquaTrace documentation more accurate, maintainable, and useful during development and review.