# AquaTrace AI Integration

## 1. Purpose and evidence standard

This document describes the AI functionality in AquaTrace only to the extent supported by the supplied source evidence.

The available migration references a `gemini_files` table, and the configuration includes AI-related document storage concepts. This is evidence that Gemini-related file metadata is represented in the data model; it is not sufficient to establish the complete AI workflow, the exact model name, retrieval algorithm, prompt, response contract, or user-facing behavior.

AI claims must be traced to the actual integration code and verified through tests or reproducible manual runs.

## 2. AI capabilities and current evidence

| Claim | Evidence currently available | Status |
|---|---|---|
| AquaTrace has Gemini-related file metadata | Initial migration defines `gemini_files` | Verified in schema |
| Gemini file names have a uniqueness constraint | Migration defines unique `gemini_file_name` | Verified in schema |
| Only one active document per source document is allowed by the relevant partial unique index | Initial migration | Verified in schema |
| File expiration must occur after upload time | Initial migration constraint | Verified in schema |
| AquaTrace uses a specific Gemini model | Exact model/provider invocation not supplied | Unverified |
| AI answers are generated using retrieval-augmented generation (RAG) | Retrieval and prompt flow not supplied | Unverified |
| Only approved documents can be used as grounding sources | Approved-source list and retrieval filters not supplied | Unverified |
| AI outputs follow a defined response schema | Prompt and output schema not supplied | Unverified |
| AI is advisory-only and cannot autonomously change operational records | Policy and enforcement code not supplied | Unverified |
| Model failures produce a safe fallback | Error handling not supplied | Unverified |
| AI behavior passes automated tests | AI tests and execution output not supplied | Unverified |

## 3. Model provider and model identity

The repository contains Gemini-related file metadata, but the exact model provider and model identifier must be established from the model invocation code and runtime configuration.

Document the following only after inspecting the implementation:

- **Provider:** Exact provider SDK or API used.
- **Model identifier:** Exact model name passed to the client.
- **Configuration:** Environment variable or settings field selecting the model.
- **Generation parameters:** Temperature, output-token limit, safety settings, and other parameters where configured.
- **Timeouts and retries:** Actual behavior implemented around the model call.

Do not infer the active model from a table name, dependency name, or general description of the AI feature.

**Evidence required:** Model integration service, dependency manifest, relevant settings, and a test or startup log that safely identifies the configured model without exposing credentials.

## 4. Input and output contract

The actual AI request and response schemas were not included in the supplied code. Until those are inspected, the following contract details remain unspecified:

### Input

- User request fields and types.
- Whether device, sensor, alert, incident, or location data is passed to the model.
- Whether document retrieval is performed before generation.
- Maximum input length and validation rules.
- Authorization checks before accessing operational or document data.
- Handling of empty requests, malformed input, and unsupported questions.

### Output

- Response structure and required fields.
- Whether citations or source-document identifiers are returned.
- How retrieved evidence is distinguished from model-generated explanation.
- Validation of structured output, if applicable.
- Behavior when the model returns an empty, malformed, or unsupported response.

**Documentation requirement:** Link the exact Pydantic request/response schemas and route that exposes the AI capability. If output is plain text rather than structured data, document that accurately.

## 5. Prompt and retrieval flow

The AI documentation should describe the flow actually implemented, not assume a particular architecture.

Use the following checklist when reviewing the source:

1. **Request entry point:** Identify the FastAPI route and its authentication requirements.
2. **Input validation:** Identify the request schema and any service-level checks.
3. **Retrieval:** Identify how candidate documents are selected and how relevance is determined.
4. **Source filtering:** Identify how approved, active, and unexpired documents are selected.
5. **Prompt construction:** Identify the exact prompt template and the context supplied to the model.
6. **Generation:** Identify the provider client and exact model identifier.
7. **Output validation:** Identify schema validation, citation checks, or post-processing.
8. **Response:** Identify the API response model and any source references returned to the caller.
9. **Failure handling:** Identify timeout, provider error, retrieval failure, and invalid-output paths.

The initial migration contains a partial unique index for active documents by source document and an expiration constraint. These constraints do not prove that the retrieval service filters out expired or unapproved documents. That must be confirmed in the retrieval query and its tests.

## 6. Approved documents and source provenance

The AI integration should clearly define which documents may be used as evidence.

The supplied schema establishes Gemini file metadata fields, including file names, upload/expiration timestamps, and source-document-related uniqueness constraints. The full source-document registry, approval mechanism, document ingestion process, and retrieval filtering logic were not supplied.

Before documenting approved-document grounding, verify:

- The canonical list or registry of approved source documents.
- How a source document is approved and updated.
- Whether active and expired records are filtered during retrieval.
- How document content is uploaded, refreshed, and deleted from the provider.
- Whether retrieved passages retain document identifiers or other provenance.
- Whether generated answers expose citations that correspond to retrieved sources.
- Whether arbitrary user-supplied documents can enter the retrieval corpus.

If these properties are not enforced in code, describe them as intended policy rather than implemented guarantees.

## 7. Advisory-only policy

For a water-quality monitoring system, AI-generated explanations should not be presented as a substitute for verified sensor measurements, laboratory results, established alert rules, or qualified operational judgment.

The documentation should state an advisory-only policy **only to the extent that it matches the implementation and product behavior**.

Verify whether the AI can:
- Explain sensor readings or alert records.
- Summarize incident or laboratory information.
- Recommend follow-up actions.
- Create, modify, resolve, or suppress alerts and incidents.
- Change sensor thresholds, WQI weights, or other operational configuration.

If the AI is intended to be advisory-only, the implementation should prevent the model from directly performing unauthorized operational actions. Verify the available tools, service calls, route permissions, and any write paths reachable from the AI workflow.

Until this is established, do not claim that the AI is technically prevented from changing operational data.

## 8. Failure handling and fallback behavior

The AI documentation must describe actual behavior for these failure cases:

| Failure case | Evidence to inspect | Status |
|---|---|---|
| Provider API error or rate limit | AI service exception handling | Not supplied |
| Provider timeout | Client timeout and retry configuration | Not supplied |
| No relevant documents found | Retrieval result handling | Not supplied |
| All candidate documents are expired or inactive | Retrieval filters and tests | Not supplied |
| Malformed or empty model response | Output validation and fallback logic | Not supplied |
| Invalid or missing citation | Citation validation and response logic | Not supplied |
| AI feature configuration missing | Startup validation or service initialization | Not supplied |

Do not claim that AquaTrace falls back to a deterministic answer, retries requests, or refuses unsupported questions unless the corresponding code or tests demonstrate it.

If there is no fallback, document the actual error response and whether the user can safely retry.

## 9. AI testing and reproducibility

No AI test source or model-run output was included in the evidence reviewed for this document. Consequently, AI behavior is not currently marked as runtime-verified.

The minimum useful test set should cover:

1. A valid request using an approved, active source document.
2. A request for which no relevant source document exists.
3. Expired or inactive document exclusion.
4. A model provider failure or timeout.
5. Empty or malformed model output.
6. Citation or source attribution correctness, if citations are part of the contract.
7. Authentication and authorization for the AI route.
8. Prompt-injection attempts contained in user input or retrieved documents.
9. Confirmation that AI output cannot bypass authorization or directly perform prohibited operational changes.
10. Any defined advisory-only behavior and required human review.

Record whether tests use a mocked provider, a test environment, or a live provider. Do not treat a mocked response as proof that the live provider, credentials, retrieval corpus, or deployment configuration works.

The supplied CI workflow runs pytest with coverage reporting:

```bash
uv run --no-sync pytest --cov --cov-report=term-missing
```

This command can provide test evidence only after the relevant tests have been added and the run has succeeded. No passing execution result was supplied.

## 10. AI evidence checklist

Complete this checklist before claiming the AI feature is fully documented.

| Evidence item | Required artifact | Current status |
|---|---|---|
| Model integration | Provider client and model invocation service | Not supplied |
| Prompt template | Exact prompt or prompt-building function | Not supplied |
| Request and response contract | FastAPI route and Pydantic schemas | Not supplied |
| Retrieval flow | Retrieval service, query, and filtering logic | Not supplied |
| Approved document sources | Source registry and approval mechanism | Not supplied |
| Gemini file lifecycle | Upload, update, expiry, and deletion code | Schema partially evidenced |
| Failure handling | Exception, timeout, retry, and fallback logic | Not supplied |
| Advisory-only enforcement | Policy plus restricted action/write paths | Not supplied |
| Automated tests | AI-specific test files and passing output | Not supplied |
| Manual verification | Reproducible request, response, and source evidence | Not supplied |

## 11. Verification status

The only AI-related implementation evidence established by the supplied material is the Gemini file metadata schema and its database constraints. The model identity, prompt, retrieval algorithm, approved-source filtering, output validation, and failure behavior remain unverified.

To complete this document, provide the AI route, model integration service, prompt template, retrieval service, Gemini file-management code, request/response schemas, configuration settings, and AI test output. The final documentation should link each claim to those concrete artifacts and distinguish verified behavior from intended policy.

