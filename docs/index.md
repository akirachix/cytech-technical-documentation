---
layout: home

hero:
  name: AquaTrace
  text: Technical Documentation
  tagline: IoT water quality monitoring and incident management for water service providers.
  actions:
    - theme: brand
      text: Start with the overview
      link: /overview/
    - theme: alt
      text: Set up your machine
      link: /dev/

features:
  - title: IoT nodes
    details: ESP32 nodes read pH, temperature, turbidity and EC, buffer data when offline, and send it over MQTT with TLS.
    link: /iot/
  - title: Backend
    details: FastAPI service with login, MFA, role based access, alert rules, WebSockets and incident workflow.
    link: /backend/
  - title: Database
    details: Ten PostgreSQL tables on Supabase, with constraints, row level security and an append-only audit log.
    link: /database/
  - title: WQI and alerts
    details: A weighted Water Quality Index and fixed alert rules. Rules set severity, never the AI.
    link: /wqi/
  - title: AI assistant
    details: Gemini explains each alert using approved guideline files. It gives advice only.
    link: /ai/
  - title: Frontend
    details: A Next.js PWA with a dashboard, nodes, alerts, incidents and reports for each role.
    link: /frontend/
---

## What AquaTrace does

Water can be safe at the treatment plant and unsafe at the tap. AquaTrace watches the network at chosen points, spots changes early, and helps officers investigate and prove what happened.

The platform measures four parameters: pH, temperature (deg C), turbidity (NTU) and electrical conductivity (uS/cm).

1. A node reads its sensors, averages the values and publishes a reading.
2. The IoT API checks each message and stores the valid ones.
3. The backend works out the WQI and raises an alert after 3 bad readings in a row.
4. Gemini adds a plain explanation to the alert.
5. A Water Quality Officer opens an incident and a Field Officer investigates, fixes and logs the work.
6. The officer checks follow-up readings and closes the incident.

## Who uses it

| Role | What this person does in AquaTrace |
|---|---|
| Water Quality Officer | Watches the dashboard and alerts, registers devices, creates and closes incidents. |
| Field Officer | Visits sites, records findings, maintenance and lab results, mostly from a phone. |
| Administrator | Creates accounts, manages WQI weights and reads the audit log. |

## Technology at a glance

| Part | Technology |
|---|---|
| Device | ESP32, pH, temperature, turbidity and EC sensors, GSM/LTE modem, GPS module. |
| Messaging | MQTT over TLS on port 8883 with HiveMQ. |
| Backend | FastAPI, SQLAlchemy 2.0, Pydantic v2, Alembic, managed with uv. |
| Database | Supabase PostgreSQL with row level security. |
| AI | Gemini with markdown guideline files from the Files API. |
| Frontend | Next.js App Router PWA. |
| Hosting | Render, Vercel, Supabase and HiveMQ Cloud. |

## Where to go next

| If you want to | Read |
|---|---|
| Understand the whole system | [Overview](/overview/) |
| Run the project locally | [Development](/dev/) |
| See tables and relationships | [Database](/database/) |
| See endpoints and auth | [Backend](/backend/) |
| Work on the device or MQTT | [IoT](/iot/) |
| Learn how scores and alerts work | [WQI](/wqi/) |
| Learn how the AI is used and limited | [AI](/ai/) |
| Review protections and threats | [Security](/security/) |
| Deploy or roll back | [Deployment](/deployment/) |
| Handle alerts, incidents and runbooks | [Operations](/operations/) |
