# CYTECH Technical Documentation

Technical documentation scaffold for the **AquaTrace platform**, built with [VitePress](https://vitepress.dev/).

## About the Project

This repository provides a centralized place to document the AquaTrace platform, including its architecture, frontend, backend, IoT monitoring system, Water Quality Index (WQI), AI assistant, and operational workflows.

The goal is to make the system easier to understand, develop, test, maintain, and hand over by providing consistent documentation across the project.

## Current Status

**Status: Documentation scaffold**

The initial documentation environment and directory structure have been created. This repository is the foundation for the project's technical documentation; it is not the AquaTrace application itself.

### What Is Set Up

- VitePress documentation framework.
- npm-based dependency management.
- Documentation homepage and initial topic directories.
- A foundation for organizing documentation by system component.
- A local development server and production-build workflow, provided the configured npm scripts are available.

### What Remains to Be Completed

- Populate each documentation section with verified technical details.
- Document actual frontend screens, components, and API integration.
- Document implemented backend endpoints, database models, and validation.
- Describe IoT hardware, sensors, and communication protocols.
- Confirm and document the implemented WQI calculation and configuration.
- Document AI/RAG workflows, limitations, alerts, incidents, and maintenance.
- Add architecture diagrams, screenshots, testing instructions, and deployment guidance.
- Review and validate documentation with the relevant project teams.

Features that are planned or not yet verified must be clearly identified as such rather than described as implemented.

## Documentation Structure

The documentation is organized by major system components. The directories and pages may expand as the project develops.

| Directory | Purpose |
|---|---|
| `docs/overview/` | Project introduction and system architecture |
| `docs/frontend/` | Frontend application and user interface |
| `docs/backend/` | API, backend services, and database |
| `docs/iot/` | Monitoring devices, sensors, and communication |
| `docs/wqi/` | Water Quality Index rules and calculation |
| `docs/ai/` | AI assistant and retrieval-augmented generation (RAG) |
| `docs/operations/` | Alerts, incidents, maintenance, and laboratory tests |
| `docs/dev/` | Developer setup and contribution guidance |
| `docs/public/` | Static assets such as images and diagrams |
| `docs/.vitepress/` | VitePress configuration and theme customization |

Some sections may still be empty or incomplete while the scaffold is being developed.

## Requirements

- Node.js compatible with the installed VitePress version.
- npm.

## Installation

Clone the repository and enter its directory:

```bash
git clone <repository-url>
cd cytech-technical-documentation
```

Install dependencies:

```bash
npm install
```

## Run the Documentation Locally

Start the development server:

```bash
npm run docs:dev
```

Open the local URL printed in the terminal, typically:

`http://localhost:5173/`

Keep the terminal running while viewing the site.

## Build for Production

Generate the production build:

```bash
npm run docs:build
```

Preview the production build, if the corresponding script is configured:

```bash
npm run docs:preview
```

## Contributing to the Documentation

1. Work on the designated documentation branch or an approved feature branch.
2. Check the existing pages before creating duplicates.
3. Use clear Markdown headings, code examples, and diagrams where useful.
4. Document verified implementation details and link related sections.
5. Label proposed or incomplete functionality clearly.
6. Run the production build before submitting changes.
7. Coordinate with the relevant team when technical details need confirmation.

## Technology

- **Documentation framework:** VitePress
- **Content format:** Markdown
- **Package management:** npm
- **Brand colors:** CYTECH teal (`#0C6E77`) and white

## Scope

This repository contains the technical documentation website and its supporting configuration. It does not replace the AquaTrace frontend, backend, IoT firmware, or other application repositories.

Documentation completeness and feature implementation status should be reviewed as the project evolves.
