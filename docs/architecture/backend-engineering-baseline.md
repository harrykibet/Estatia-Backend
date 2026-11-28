# Backend Engineering Baseline

## Purpose

This document describes the engineering baseline and target architecture for Estatia Backend. It is an incremental direction, not a claim that the current implementation is already production-ready.

The backend is the authoritative boundary for identity, authorization, property ownership, payments, notifications, and integrations. Android, iOS, and Web are clients; they must not be trusted to enforce privileged business rules.

## Current source layout

The existing Functions code is grouped by capability:

```text
functions/src/
├── auth/
├── common/
├── di/
├── firestore/
├── notifications/
├── payments/
├── properties/
├── security/
└── index.ts
```

This is an acceptable initial module map. The current modules contain scaffolding and incomplete workflows, so folders alone must not be interpreted as implemented capabilities.

## Target module boundaries

Evolve modules incrementally toward:

```text
modules/
└── <capability>/
    ├── domain/           # Business rules and domain types; no Firebase imports
    ├── application/      # Use cases and orchestration; depends on ports
    ├── infrastructure/  # Firestore, Secret Manager, provider adapters
    └── transport/        # Callable/HTTP/event triggers and request mapping
```

Shared platform concerns belong outside business modules:

- Configuration and secret binding.
- Structured logging, tracing, metrics, and correlation.
- Authentication and authorization primitives.
- Validation and error mapping.
- External-service clients with bounded timeouts.
- Persistence adapters and transaction boundaries.

### Dependency direction

- Domain code must not import Firebase Admin, Firebase Functions, Axios, or provider SDKs.
- Application use cases depend on interfaces/ports, not concrete database or network clients.
- Infrastructure implements those ports.
- Transport handlers authenticate, validate, authorize, map errors, and invoke application use cases.
- Cross-module calls should use stable application interfaces or versioned contracts, not reach into another module's infrastructure.

Do not introduce an abstraction that only forwards calls without enforcing a real boundary.

## API and client compatibility

- Define versioned, language-neutral API/data contracts for shared mobile and web workflows.
- Keep server-owned business rules authoritative.
- Treat changes to request/response shapes, error codes, IDs, enum values, and Firestore document models as compatibility changes.
- Add contract tests for behavior consumed by Android, iOS, and Web.
- Do not generate client SDKs until the source contracts and versioning policy have been agreed.

## Security baseline

- App Check is not authentication or authorization.
- Every protected callable/HTTP operation must authenticate the caller and authorize the specific resource/action.
- Never accept a client-supplied Secret Manager resource name as authority to disclose that secret.
- Keep private credentials on trusted server infrastructure.
- Validate all untrusted request data at runtime.
- Use least-privilege service identities and narrowly scoped secret bindings.
- The legacy client-callable `getSecret` export must fail closed and must never access Secret Manager; it is retained temporarily only to avoid deleting a possibly deployed function before inventory and consumer review.
- Client-required public configuration (for example Firebase SDK configuration or payment publishable keys) is not a Secret Manager secret and must be explicitly classified, restricted at its provider, and distributed through build-time configuration or a separate narrow public-config contract.
- Do not enable or deploy Firestore/Storage policy until the actual client access model is inventoried and emulator tests cover both allowed and denied cases.
- Keep production deployment credentials out of pull-request workflows.

## Verification levels

| Level | Purpose | Backend checks |
| --- | --- | --- |
| 0 | Static baseline | ESLint, TypeScript typecheck, dependency-lock integrity |
| 1 | Unit verification | Domain/application/unit tests and deterministic mocks |
| 2 | Integration | Functions Emulator, Firestore/Storage rules emulator, provider mocks, API contracts |
| 3 | Release confidence | Production build, staging smoke tests, migration/rollback review, security and operational checks |

The current foundation implements lint, type checking, unit tests, build verification, and Functions Emulator callable tests. Firestore/Storage rules verification is intentionally deferred until issue #2 is resolved.

## Explicit production blockers found in the initial audit

- [#1 — Client-accessible Secret Manager retrieval and Android/backend transport mismatch](https://github.com/harrykibet/Estatia-Backend/issues/1).
- [#2 — Missing Firestore and Storage authorization policy](https://github.com/harrykibet/Estatia-Backend/issues/2).
- [#3 — M-Pesa placeholder, authorization, idempotency, callback and reconciliation work](https://github.com/harrykibet/Estatia-Backend/issues/3).
- [#4 — Required branch protection and merge checks](https://github.com/harrykibet/Estatia-Backend/issues/4).

Other placeholder callable implementations must also be reviewed before release. Passing CI proves that the code meets the automated checks configured here; it does not by itself establish production readiness.

## Evolution policy

Prefer a modular monolith while deployment, ownership, and scaling requirements remain aligned. Extract independently deployed services only when justified by measurable scaling, security, availability, or ownership requirements. Do not introduce Kafka, Kubernetes, Redis, or multiple databases solely to match a future-state diagram.
