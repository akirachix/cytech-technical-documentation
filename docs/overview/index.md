# System Overview

## 1. Introduction

AquaTrace is a water-quality monitoring and incident-response platform developed to connect monitoring data with the information needed to assess water quality and investigate abnormal conditions.

The platform brings together a web application, backend APIs, structured data storage, monitoring-device information, and operational workflows. Its broader project requirements also describe alert management, incident investigation, laboratory testing, and AI-assisted decision support.

## 2. Problem and Purpose

Water-quality measurements are more useful when they can be associated with a known monitoring location, reviewed over time, assessed consistently, and connected to the actions taken in response to abnormal conditions.

AquaTrace is intended to support this process by providing a centralized way for authorised users to review monitoring information and manage the operational records associated with water-quality events.

## 3. Main System Components

| Component | Responsibility |
|---|---|
| Web frontend | Presents monitoring information and user workflows |
| Backend API | Validates requests, enforces application rules, and exposes data through HTTP endpoints |
| PostgreSQL database | Stores structured application records |
| Monitoring devices | Produce sensor measurements and device information |
| Device and location management | Associates monitoring devices with identifiable locations |
| WQI processing | Calculates and stores Water Quality Index results where supported by the implementation |
| Operational workflows | Support maintenance, laboratory testing, alerts, and incident response where implemented |
| AI-assisted decision support | Intended to help explain monitoring evidence; complete runtime behaviour requires verification |

## 4. Technology

The application repositories use the following technologies:

- **Frontend:** Next.js, React, and TypeScript
- **Backend:** Python and FastAPI
- **Data validation:** Pydantic
- **Database access:** SQLAlchemy
- **Database migrations:** Alembic
- **Database:** PostgreSQL
- **API documentation:** OpenAPI, exposed through the FastAPI application

The exact dependency versions should be taken from the respective repositories' dependency and configuration files.

## 5. Intended Users

The project role model distinguishes administrative responsibilities from operational water-quality work.

- **Administrator:** responsible for user and account administration.
- **Water Quality Officer:** responsible for authorised operational monitoring and water-quality investigation.
- **Field Officer:** responsible for field activities and records permitted by their role and assignments.

The final permissions for each role must be confirmed against backend authorization checks and tests. The interface alone does not establish access rights.

## 6. Core Information Concepts

AquaTrace works with device and location information and sensor measurements. Its broader domain includes WQI assessments and operational records.

The following concepts must remain distinct:

- A **sensor reading** is a measurement reported by a device.
- A **WQI result** is an assessment calculated from measurement data using defined rules.
- An **alert** is an operational signal generated according to configured conditions.
- An **incident** is an operational record used to investigate and respond to a condition.
- An **AI-generated explanation**, where available, is decision-support information rather than an authoritative measurement.

## 7. System Boundaries

The frontend communicates with the backend through APIs. The backend is responsible for enforcing validation, authorization, and business rules.

Device telemetry, external message brokers, reverse geocoding, and AI services require their own verified integrations. Their inclusion in the intended architecture does not, by itself, prove that an end-to-end integration is operational.

GPS provides coordinates, not a human-readable street address. Address enrichment requires an additional source or geocoding service.

## 8. Implementation Status

This documentation is being populated from the project repositories, database migrations, API schemas, tests, and approved requirements.

Features are described as implemented only when supported by implementation evidence. Features whose runtime behaviour has not been verified are identified as unverified or planned.

The web frontend and backend are maintained separately:

- [AquaTrace frontend repository](https://github.com/akirachix/cytech-frontend)
- [AquaTrace backend repository](https://github.com/akirachix/cytech-backend)

## 9. Related Documentation

- [System Architecture](./architecture)
- [Data Flow](./data-flow)
- [Frontend Documentation](../frontend/)
- [Backend API](../backend/)
- [Database](../database/)
- [IoT Monitoring](../iot/)
- [WQI](../wqi/)
- [AI-Assisted Decision Support](../ai/)
- [Security](../security/)
- [Operations](../operations/)
