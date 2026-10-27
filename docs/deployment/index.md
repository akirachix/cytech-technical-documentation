# AquaTrace Deployment

## 1. Overview

AquaTrace uses GitHub Actions workflows for pull-request checks, tests, linting, formatting, and deployment. The supplied deployment workflow targets **Heroku** and deploys from the `main` branch through the Heroku Platform API.

The deployment workflow runs the CI workflow before deploying and then checks the application's `/health` endpoint.

This document describes the supplied workflow configuration. It does not claim that a particular deployment is currently healthy or that the workflows have passed in a live run.

## 2. Deployment platform and trigger

### 2.1 Platform

The deployment workflow is named `Deploy to Heroku` and communicates with the Heroku Platform API directly. The runner packages the repository source into a compressed archive, uploads it to the source endpoint, and creates a Heroku build for the configured application.

The workflow does not require the Heroku CLI for this process.

### 2.2 Deployment triggers

The workflow supports:
- Pushes to `main`.
- Manual execution through `workflow_dispatch`.

The CI and deployment jobs are guarded by a condition requiring the reference to be `refs/heads/main`. A concurrency group named `production` prevents overlapping production deployments from running concurrently; the workflow does not cancel an in-progress deployment when another run joins that group.

### 2.3 Deployment sequence

The supplied workflow follows this sequence:

1. Confirm the required Heroku configuration is present.
2. Check out the repository.
3. Set up the Python version specified in `.python-version`.
4. Package the source, excluding `.git`.
5. Upload the source archive to Heroku.
6. Create a Heroku build associated with the current Git commit.
7. Poll the build status and fail the job unless the status is `succeeded`.
8. Request the configured application's `/health` endpoint, retrying transient failures.

The deployment job depends on the CI job. A failed CI job therefore prevents the deployment job from proceeding.

## 3. GitHub Actions configuration

### 3.1 CI workflow

The supplied CI workflow:
- Runs on a self-hosted runner labeled `classroom-ci`.
- Sets `DATABASE_URL` to `sqlite://` for the test job.
- Defines a test-only `JWT_SECRET`.
- Checks out the repository without persisting checkout credentials.
- Installs Python using `.python-version`.
- Installs dependencies from `pyproject.toml` using `uv`.
- Runs pytest with coverage reporting.

The test command is:

```bash
uv run --no-sync pytest --cov --cov-report=term-missing
```

The workflow comments explicitly state that pytest should fail if no tests are collected.

The CI configuration demonstrates that automated tests and coverage reporting are configured. It does not establish that the tests currently pass or that the SQLite test environment reproduces production PostgreSQL behavior.

### 3.2 Pull-request checks

The supplied pull-request workflow targets pull requests to `main` and `develop`.

It includes these stages:

| Stage | Purpose |
|---|---|
| PR requirements | Validate the PR title, description, testing evidence, and test-file updates |
| Lint and format | Run Ruff lint checks and formatting validation |
| CI | Run the reusable tests-and-coverage workflow |
| PR gate | Fail if a required stage does not succeed |
| PR feedback | Update the PR checklist and readiness comment when permitted |

The workflow uses a concurrency group based on the pull-request number and cancels superseded PR runs.

The requirements check validates that Python source changes are accompanied by test changes, unless the specified `no-tests-needed` label and an adequate exception explanation are present. It also checks for a descriptive title, a sufficiently detailed Description section, and testing evidence.

The feedback job avoids checking out or executing pull-request code. It only updates PR feedback for pull requests originating from the same repository, because fork workflows may not have permission to update pull requests.

The workflow's gate requires the requirements, lint, and CI jobs to succeed. Passing these checks indicates readiness for peer review under the workflow's policy; it does not replace peer review or establish that a release is free of defects.

### 3.3 Runner requirements

The supplied CI and PR workflows use a self-hosted runner with the labels:

```yaml
runs-on: [self-hosted, classroom-ci]
```

The deployment process therefore depends on an available runner matching those labels. The runner must have the operating-system tools needed by the workflows, including shell utilities, `curl`, `tar`, Python, and `uv`.

The runner's operating system, patching policy, network restrictions, isolation, and access controls were not included in the supplied configuration and should be verified separately.

## 4. Required deployment configuration

The deployment workflow checks for these production environment values before deployment:

| Name | Purpose |
|---|---|
| `HEROKU_API_KEY` | Authenticates requests to the Heroku Platform API |
| `HEROKU_EMAIL` | Required by the workflow's configuration check |
| `HEROKU_APP_NAME` | Identifies the target Heroku application |
| `HEROKU_APP_URL` | Base URL used for the post-deployment health check |

The workflow obtains `HEROKU_API_KEY` from GitHub environment secrets and the application name and URL from GitHub environment variables. The production environment is named `production`.

`HEROKU_EMAIL` is checked for a non-empty value but is not passed to the shown deployment API commands. Its purpose beyond the configuration check is not established by the supplied workflow.

The application also defines settings that must be configured appropriately for the runtime environment:

| Application setting | Purpose |
|---|---|
| `DATABASE_URL` | Database connection string |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` or corresponding key paths | JWT signing and verification |
| `JWT_ISSUER` | JWT issuer validation |
| `MFA_ENCRYPTION_KEY` | MFA secret encryption |
| `CORS_ORIGINS` / `FRONTEND_ORIGIN` | Browser-origin configuration |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` | Email delivery |
| `LOCATIONIQ_API_KEY` | Location integration |
| `GPS_INTEGRATION_API_KEY` | GPS integration |

The actual names accepted by the settings model are defined in the application configuration. Confirm the platform environment variables match those names and that required values are set before deployment.

**Secrets must not be committed to the repository.** Use GitHub environment secrets or the hosting platform's protected configuration for sensitive values. The repository's `.env` support is a local configuration mechanism, not a recommendation to deploy a committed `.env` file.

## 5. Database and migrations

AquaTrace uses SQLAlchemy models and Alembic migrations. The supplied initial migration creates tables and constraints for users, audit logs, devices, sensor readings, alerts, incidents, laboratory tests, maintenance records, locations, and Gemini file records.

The database configuration normalizes a connection URL beginning with `postgres://` to `postgresql://`.

The supplied deployment workflow does **not** show an Alembic migration command. Therefore, automatic migration execution during deployment is not established.

Before deploying a database schema change:
1. Review the migration and its compatibility with the currently deployed application.
2. Confirm a backup and recovery procedure appropriate to the environment.
3. Run migrations using the project's approved migration process.
4. Verify migration completion and application database connectivity.
5. Confirm the application can read and write the expected schema.

The exact production migration command, backup process, rollback procedure, and database service configuration were not supplied and must be documented from the actual operational setup.

## 6. Health check and deployment verification

After a successful Heroku build, the workflow requests:

```bash
curl --fail --location --retry 5 --retry-all-errors --retry-delay 5 \
  --connect-timeout 10 --max-time 30 \
  "${HEROKU_APP_URL%/}/health"
```

The command:
- Fails for unsuccessful HTTP responses.
- Follows redirects.
- Retries errors up to five times with a five-second delay.
- Uses a 10-second connection timeout and a 30-second maximum request time.

This establishes that the workflow checks the health endpoint after deployment. The endpoint's actual checks are not shown here. Do not claim that it verifies database connectivity, migrations, external integrations, or end-to-end functionality unless its implementation confirms those checks.

The build log streaming command tolerates a streaming failure with `|| true`; the workflow separately checks the Heroku build status and fails unless it is `succeeded`.

## 7. Local verification commands

The following commands are consistent with the supplied CI and PR workflow configuration. Run them in the project's configured Python environment.

### Install development dependencies

```bash
uv venv
uv pip install -r pyproject.toml --group dev
```

### Run tests with coverage

```bash
uv run --no-sync pytest --cov --cov-report=term-missing
```

### Run lint checks

```bash
uv run --no-sync ruff check .
```

### Check formatting

```bash
uv run --no-sync ruff format --check .
```

Record the command output and exit status when updating release documentation. A configured command is not evidence that it has passed.

## 8. Deployment verification matrix

| Claim | Evidence | Status |
|---|---|---|
| Production deployment targets Heroku | `Deploy to Heroku` workflow | Verified in workflow configuration |
| Deployment is triggered from `main` or manually | Workflow trigger and job conditions | Verified in workflow configuration |
| CI runs before deployment | Deployment job dependency on CI | Verified in workflow configuration |
| Tests run with coverage reporting | `ci.yml` test job | Verified in workflow configuration; result not supplied |
| Pull requests receive lint, format, test, and requirements checks | PR checks workflow | Verified in workflow configuration; result not supplied |
| Deployment checks `/health` | Post-deployment `curl` step | Verified in workflow configuration |
| Database migrations run automatically during deployment | No migration step shown | Not verified |
| Health check validates database and integrations | Health endpoint implementation not supplied | Not verified |
| Production secrets are correctly configured | GitHub environment and Heroku runtime settings | Not verified |
| HTTPS and database TLS are enforced | Hosting and database configuration | Not verified |
| Backups and rollback are operational | Operational procedures not supplied | Not verified |
| Current production deployment is healthy | Live deployment and health-check results | Not verified |

## 9. Operational recommendations

Before treating the deployment process as production-ready, verify and document:

1. The required GitHub production environment secrets and variables are configured.
2. The Heroku application uses the expected runtime, start command, and dependency installation process.
3. Database migrations are run through an explicit, tested process.
4. The `/health` endpoint checks the components required for safe operation.
5. Production HTTPS, database transport security, and allowed CORS origins are configured.
6. Backups, restoration, and application rollback procedures have been tested.
7. The self-hosted runner is patched, access-controlled, and isolated appropriately.
8. Successful CI, PR, build, and post-deployment health-check results are retained as release evidence.

