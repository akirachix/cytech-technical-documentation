# System Overview

AquaTrace is a water quality monitoring platform spanning IoT devices, a backend API, and analytics.

> Note: This documentation describes the intended design. Items marked **(unverified)** have not been confirmed against the application codebase, which is not present in this repository.

## Architecture

- IoT devices collect sensor readings and report to the backend.
- Backend stores readings, locations, WQI configuration, alerts, incidents, maintenance records, and lab tests.
- AI/RAG layer supports analysis (status: **unverified**).

## Data Model (intended)

- Locations, sensor readings, WQI config, alerts, incidents, maintenance records, lab tests.

## Open Questions

- Actual API routes and database schema must be verified against source code.
