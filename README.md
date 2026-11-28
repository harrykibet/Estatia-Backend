# Estatia Backend

Estatia Backend is the server-side platform for the Estatia real-estate ecosystem. It currently uses Firebase Cloud Functions (2nd generation), TypeScript, Firebase Admin SDK, Cloud Secret Manager, and external service integrations.

The backend is intended to own privileged operations and authoritative business rules. Client applications must not receive private backend credentials or decide authorization solely from client-supplied identifiers.

## Current engineering status

This repository is undergoing a foundation and security audit. The current source contains scaffolding and incomplete integrations; the existence of a function or module does not mean that capability is production-ready.

Known blockers are tracked explicitly:

- [#1 — Secure the client-accessible Secret Manager retrieval path and align its client contract](https://github.com/harrykibet/Estatia-Backend/issues/1).
- [#2 — Define and test Firestore and Storage authorization rules](https://github.com/harrykibet/Estatia-Backend/issues/2).
- [#3 — Implement an authenticated, idempotent M-Pesa payment lifecycle](https://github.com/harrykibet/Estatia-Backend/issues/3).
- [#4 — Protect `master` with required verification checks](https://github.com/harrykibet/Estatia-Backend/issues/4).

Do not treat the current backend as production-ready until the relevant security and product workflows have been implemented and verified.

## Architecture

The current code is organized by capability under `functions/src`:

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

The target direction is a modular monolith with explicit domain, application, infrastructure, and transport boundaries. Domain and application logic should not depend directly on Firebase SDK implementations. See [the engineering baseline](docs/architecture/backend-engineering-baseline.md).

## Requirements

- Node.js 24 (matches the Cloud Functions runtime configured in `functions/package.json`).
- npm.
- Firebase CLI 15.37.0 for the documented local emulator commands.

## Local setup

```bash
git clone https://github.com/harrykibet/Estatia-Backend.git
cd Estatia-Backend
npm ci --prefix functions
npm --prefix functions run lint
npm --prefix functions run typecheck
npm --prefix functions test
```

The test command builds the TypeScript sources and then runs the Node.js built-in unit-test runner.

## Functions emulator

The repository configures only the Functions emulator at this stage. Firestore and Storage rules are currently empty and are deliberately not enabled as emulator/deployment configuration until their intended client access model is reviewed.

```bash
npx --yes firebase-tools@15.37.0 emulators:exec \
  --project demo-estatia-ci \
  --only functions \
  --non-interactive \
  "npm --prefix functions run test:emulator"
```

The `demo-estatia-ci` project ID is reserved for local/emulated execution. Emulator tests must not connect to a production Firebase project or require production credentials.

See [local emulator operations](docs/operations/local-functions-emulator.md).

## Configuration and secrets

Never commit service-account files, API credentials, payment-provider secrets, debug tokens, production exports, or personal data. Private credentials belong in a server-side secret store and must be accessed only by authorized server code.

App Check is an additional abuse-control layer. It does not replace Firebase Authentication, resource-level authorization, input validation, or server-side business rules.

## Deployment

There is intentionally no automatic production deployment workflow. Deployments require a separately reviewed environment and explicit project selection. Before any deployment, verify the target project, deployed function inventory, IAM/service-account permissions, Firestore/Storage rules, and secret bindings.

Do not rely on the `default` project alias in `.firebaserc` as proof that the selected project is safe. Use an explicit, reviewed project ID when invoking deployment commands.

## Engineering checks

Pull requests and pushes to `master` run the Backend PR Verification workflow:

- ESLint.
- TypeScript type checking.
- Unit tests.
- TypeScript build.
- Functions Emulator callable smoke test.

The nightly workflow repeats the full verification and retains build/emulator evidence. The security workflow runs CodeQL and a runtime dependency audit.

## License

Copyright © Estatia. All rights reserved.
