# Developer Setup

## 1. Overview

This guide explains how to set up a local AquaTrace development environment, work on the backend and documentation site, run tests and code-quality checks, and prepare changes for review.

AquaTrace includes a Python backend, database-backed application services, authentication and authorization, automated tests, CI/CD workflows, and a JavaScript-based documentation site.

Some setup details depend on the current repository configuration. In particular, confirm the backend startup command, migration command, and required environment variables from the project files before running the application.

## 2. Development Prerequisites

Install the tools required for the part of the project you intend to work on.

| Tool | Purpose |
|---|---|
| Git | Clone the repository and manage changes |
| Python | Run the backend and Python tests |
| `uv` | Manage Python dependencies and run project commands |
| Node.js and npm | Install and run the documentation site |
| Database service | Run the backend against a supported database configuration |
| Postman | Exercise API endpoints and run request-level checks |
| Playwright | Run browser-based end-to-end tests where configured |

Use the Python version specified in `.python-version`. Check the project configuration for the required Node.js version and supported database version.

Before continuing, confirm that the relevant commands are available:

```bash
git --version
python --version
uv --version
node --version
npm --version
```

These commands check the installed tools. They do not verify that all project dependencies or services are configured.

## 3. Get the Project Ready

Open a terminal in the repository root, where the backend project configuration and CI workflows are available.

If you have not cloned the repository yet, use the repository URL provided by your project team:

```bash
git clone <repository-url>
cd <repository-directory>
```

Replace the placeholders with the actual repository URL and directory name.

Inspect the project configuration before installing dependencies. Useful files include:

- `.python-version`: Python version used by CI.
- `pyproject.toml`: Python dependencies, project configuration, and development tools.
- `uv.lock`, if present: locked Python dependency versions.
- `package.json`: npm dependencies and documentation scripts.
- `.github/workflows/ci.yml`: automated test workflow.
- `.github/workflows/`: additional pull-request and deployment workflows.
- Database migration files: schema changes and migration history.
- Backend settings and configuration modules: environment variables and defaults.

Do not commit private keys, passwords, API tokens, production credentials, or local environment files containing secrets.

## 4. Set Up the Python Backend

### 4.1 Install Python dependencies

The CI workflow installs the Python project and development dependencies using `uv`. From the directory containing `pyproject.toml`, run:

```bash
uv pip install -r pyproject.toml --group dev
```

If the repository provides a locked environment workflow or additional setup instructions, follow those instructions to keep your local environment aligned with the project.

The CI test command uses `uv run --no-sync`, which assumes the required environment has already been prepared.

### 4.2 Review the backend structure

The backend is organized into components with distinct responsibilities:

- **API routers:** Define HTTP endpoints and request handling.
- **Core configuration and security:** Configure application settings, JWT handling, password hashing, and authentication dependencies.
- **Services:** Implement application logic, including authentication and audit logging.
- **Repositories:** Handle database access and queries.
- **Models and schemas:** Represent persisted entities and API input/output structures.
- **Database migrations:** Apply schema changes over time.
- **Tests:** Check application behavior and expected error cases.

When making changes, follow the existing module patterns. Keep HTTP request handling separate from business logic and database operations where the current architecture supports that separation.

### 4.3 Configure environment variables

AquaTrace uses application settings for database connectivity, authentication, integrations, email, and frontend access.

Review the settings definitions and any existing environment examples before starting the application.

| Configuration area | Purpose |
|---|---|
| `DATABASE_URL` | Database connection |
| `FRONTEND_ORIGIN` and `CORS_ORIGINS` | Frontend origin and cross-origin access |
| JWT signing and verification keys | Token creation and validation |
| JWT access-token lifetime | Controls access-token expiry |
| JWT refresh-token lifetime | Controls refresh-token expiry |
| JWT issuer and audience settings | Token validation configuration |
| MFA encryption key | Protects stored MFA secrets |
| OAuth settings | External authentication integration, where configured |
| Location and GPS integration keys | External location services, where configured |
| SMTP settings | Email delivery for applicable workflows |

The settings module includes defaults for some JWT values, but that does not mean every setting is optional. For example, the database URL is required by the supplied configuration.

Use test-only credentials and keys for local development. Generate appropriate development keys using the project's established process. Do not copy production secrets into a local environment.

Before starting the backend, confirm which settings are required by the active application configuration and which integrations can be disabled or mocked during local development.

## 5. Configure the Database

The backend uses relational database models and migrations. The schema includes users, audit logs, devices, sensor readings, alerts, incidents, laboratory tests, locations, and related records.

### 5.1 Prepare a development database

Use the database engine and connection format supported by the current project configuration.

Set `DATABASE_URL` to a local development database or a dedicated test database. Do not use a production database for development or automated tests.

The CI workflow sets:

```bash
DATABASE_URL=sqlite://
```

This is a CI-specific setting. Do not assume that this configuration is suitable for every local workflow or that it reproduces all production database behavior.

### 5.2 Apply migrations

Review the repository's migration configuration and migration history to identify the supported migration tool and command.

Apply migrations using the command documented by the project. Confirm that the database schema is up to date before running the backend or tests that depend on database tables.

When modifying a model or database constraint:

1. Update the model or relevant schema definition.
2. Create a migration using the repository's migration workflow.
3. Review the generated migration before applying it.
4. Test the migration against a development database.
5. Check relevant constraints, foreign keys, and indexes.
6. Include the migration in the same change as the code that requires it.

Do not edit an already-applied migration as a substitute for creating a new migration unless the project's migration policy explicitly permits it.

The exact migration-generation and migration-application commands should be confirmed from the repository configuration before use.

## 6. Run the Backend

The exact backend startup command must match the application's entry point and scripts defined in the repository.

To identify the supported command:

1. Inspect `pyproject.toml` for project scripts and development commands.
2. Inspect the application entry point and ASGI application definition.
3. Check the repository README and existing deployment configuration.
4. Confirm the required environment variables and database setup.
5. Use the documented command to start the backend.

Once the API is running, use the configured local base URL to access the available endpoints. If an API documentation interface is enabled, use it to inspect request parameters, response schemas, and authentication requirements.

The deployment workflow checks a `/health` endpoint after deployment. Confirm the local health-check route and port from the application configuration rather than assuming the production URL or local port.

## 7. Authentication and API Development

AquaTrace uses JWT-based authentication and supports role-based access control. Its supplied backend implementation includes password hashing, access and refresh tokens, multi-factor authentication, password reset workflows, and audit logging.

When developing or testing protected endpoints:

- Verify that authentication is required where intended.
- Check role permissions for administrative and other restricted operations.
- Validate request data and error responses.
- Avoid exposing secrets, password hashes, tokens, or sensitive personal data in logs.
- Add or update tests when changing authentication or authorization behavior.
- Check whether sensitive actions should create audit events.
- Verify rate limits and token expiry behavior where applicable.

Use Postman to exercise API endpoints and inspect responses. Keep environment variables and credentials in local or appropriately secured Postman environments rather than committing private values into shared collections.

## 8. Run Automated Tests

### 8.1 Run the Python test suite

The CI workflow uses the following command:

```bash
uv run --no-sync pytest --cov --cov-report=term-missing
```

Run this command after preparing the Python environment and configuring the database requirements for the tests.

The command runs pytest with coverage reporting. Review the output for:

- Failed tests and error tracebacks.
- Tests skipped because of environment requirements.
- Coverage summaries.
- Source lines not covered by tests.

A successful local run does not guarantee that every integration or deployment environment will behave identically.

### 8.2 Add tests for changes

Add or update tests whenever a change modifies application behavior.

Useful test areas include:

- Successful and unsuccessful login.
- User creation and authentication.
- Password changes, including incorrect current passwords.
- Password-strength validation.
- Requests made without authentication.
- Role-based authorization.
- MFA setup and verification.
- Password-reset expiry and attempt limits.
- Database constraints and repository behavior.
- Audit events for sensitive operations.

The existing supplied test examples include login, user creation, authentication, and password-change cases. Do not assume that every scenario listed above is already implemented.

### 8.3 Test API requests with Postman

Use Postman to verify request and response behavior across API workflows.

Recommended scenarios include:

1. Successful authentication with valid credentials.
2. Rejection of invalid credentials.
3. Access to protected routes with and without a valid token.
4. Authorization checks for different user roles.
5. Validation of malformed or incomplete request bodies.
6. Password-reset and MFA workflows.
7. Rate-limited endpoint behavior.
8. Expected response status codes and response structures.

Where the project uses Postman test scripts, add assertions for the response status, required fields, and relevant business rules. Store reusable configuration in Postman environments and avoid logging real credentials or tokens.

### 8.4 Test browser workflows with Playwright

Use Playwright for browser-based workflows when the frontend and its test configuration are available.

Potential end-to-end scenarios include:

- Login and logout.
- Navigation between authenticated pages.
- Display of authorization errors.
- Form validation and submission.
- Error messages for unsuccessful API requests.
- Important user workflows that cross the frontend and backend.

Confirm the configured Playwright language, test directory, browser setup, and npm scripts before running the browser suite. Do not assume a particular Playwright command is configured if it is not present in the project.

## 9. Run Code-Quality Checks

The pull-request workflow uses Ruff for Python linting and formatting checks.

Run the checks from the Python project directory:

```bash
uv run ruff check .
uv run ruff format --check .
```

The first command checks for lint issues. The second verifies formatting without changing files.

If formatting changes are required, run:

```bash
uv run ruff format .
```

Then rerun the lint and formatting checks, followed by the relevant tests.

Keep changes focused and follow existing naming, error-handling, typing, and module conventions.

## 10. Set Up the Documentation Site

The documentation site has its own npm workflow. Run these commands from the directory containing the documentation site's `package.json`.

### 10.1 Install dependencies

```bash
npm install
```

This installs packages declared by the project's npm configuration.

### 10.2 Start the documentation server

```bash
npm run docs:dev
```

Open the local URL printed by the command. The URL and port depend on the site's configuration.

### 10.3 Build the documentation

```bash
npm run docs:build
```

Review the terminal output and resolve build errors before proceeding.

### 10.4 Preview the production build

```bash
npm run docs:preview
```

Use the preview to verify the built documentation, navigation, links, and rendered pages before submitting documentation changes.

### 10.5 Documentation workflow

For a normal documentation change:

1. Install dependencies if needed.
2. Start the documentation development server.
3. Edit the relevant Markdown or configuration files.
4. Check the rendered pages and navigation.
5. Run the production build.
6. Preview the production build.
7. Commit the verified changes.

If a documentation command is not recognized, confirm that the matching script exists in `package.json`.

## 11. CI and Pull Requests

The repository's GitHub Actions workflows include automated checks for changes and a deployment workflow.

The supplied CI configuration:

- Uses a self-hosted runner labelled `classroom-ci`.
- Sets a test database URL and a test-only JWT secret.
- Uses the Python version specified by `.python-version`.
- Installs development dependencies with `uv`.
- Runs pytest with coverage reporting.

The pull-request checks include requirements, lint and formatting checks, tests, and a final gate for the required checks.

The deployment workflow runs after the relevant CI prerequisite and deploys changes to Heroku when triggered by its configured conditions. It also checks the deployed `/health` endpoint.

Before opening a pull request:

1. Run the relevant automated tests locally.
2. Run lint and formatting checks.
3. Build the documentation if it changed.
4. Review the diff for unrelated changes and accidental secrets.
5. Update tests and documentation to match behavior changes.
6. Confirm that migrations are included when required.
7. Explain the change and the checks performed in the pull request.

Local checks complement CI; they do not replace the required repository workflows.

## 12. Troubleshooting

### Python dependencies fail to install

- Confirm that the Python version matches `.python-version`.
- Confirm that `uv` is installed.
- Run commands from the directory containing `pyproject.toml`.
- Review the dependency error and check for missing system requirements.

### The backend fails to start

- Verify that required environment variables are set.
- Confirm that `DATABASE_URL` points to an accessible development database.
- Check that migrations have been applied.
- Inspect the application logs for configuration or import errors.
- Verify the entry point and startup command from the repository.

### Database or migration errors occur

- Confirm the database service is running.
- Check the connection URL and credentials.
- Verify that the expected schema exists.
- Review the latest migration and any database-specific assumptions.
- Use a development database rather than production data.

### Tests fail locally

- Read the first relevant traceback and identify the failing test.
- Confirm that test dependencies are installed.
- Check database setup and test environment variables.
- Determine whether the failure depends on an external service.
- Rerun the affected test after fixing the cause, then rerun the relevant suite.

### Ruff reports issues

Run the formatter where appropriate, resolve lint findings, and repeat both checks:

```bash
uv run ruff check .
uv run ruff format --check .
```

### The documentation build fails

- Confirm that Node.js and npm are installed.
- Run the command from the documentation directory containing `package.json`.
- Check the terminal output for missing dependencies, broken links, or configuration errors.
- Rebuild before previewing the production output.

### The preview does not show recent changes

Run the build command again, then restart or refresh the preview as appropriate.

## 13. Recommended End-to-End Workflow

For a backend change:

1. Pull the latest repository changes.
2. Review the relevant modules and configuration.
3. Set up dependencies and a development database.
4. Make the implementation change.
5. Add or update tests.
6. Run the test suite.
7. Run Ruff checks.
8. Review migrations and security implications.
9. Update the documentation if needed.
10. Review and commit the change.
11. Open a pull request and check the CI results.

For a documentation-only change:

1. Install npm dependencies if needed.
2. Run `npm run docs:dev`.
3. Edit and review the documentation.
4. Run `npm run docs:build`.
5. Run `npm run docs:preview`.
6. Review navigation and rendered pages.
7. Commit the verified changes and open a pull request.

## 14. Setup Details to Verify

To keep this guide accurate as the repository evolves, confirm and document the following items directly from the project:

- The required Python, Node.js, and database versions.
- The canonical backend startup command.
- The exact database migration commands.
- The complete list of required and optional environment variables.
- Whether a sample environment file is provided.
- The local API base URL and API documentation URL.
- The configured Postman collection and environment files.
- The Playwright installation and test commands.
- The required local services for integration tests.

These details should be filled in from the repository's actual configuration rather than inferred from the CI workflow alone.

## 15. Scope

This guide combines the established Python dependency, test, lint, CI, and documentation workflows with practical guidance for local development. It does not replace the detailed backend, security, testing, deployment, or architecture documentation.

Where an exact command or requirement has not been verified, consult the repository configuration and update this guide once the supported workflow is confirmed.