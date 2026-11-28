# Contributing to Estatia Backend

## Prerequisites

- Node.js 24.
- npm (use the lockfile; do not replace `npm ci` with an unconstrained install in CI).
- Firebase CLI 15.37.0 when running the documented emulator workflow.

## Set up the repository

```bash
git clone https://github.com/harrykibet/Estatia-Backend.git
cd Estatia-Backend
npm ci --prefix functions
```

## Required local checks

Run these before opening or updating a pull request:

```bash
npm --prefix functions run lint
npm --prefix functions run typecheck
npm --prefix functions test
```

The test command compiles the Functions sources and runs the built-in Node.js unit tests.

## Functions Emulator verification

The current emulator configuration intentionally enables only Cloud Functions. Firestore and Storage rules are empty and have not yet been mapped to the client data-access model; do not enable those emulators or invent permissive rules as a shortcut.

Run the callable smoke test without connecting to a real Firebase project:

```bash
npx --yes firebase-tools@15.37.0 emulators:exec \
  --project demo-estatia-ci \
  --only functions \
  --non-interactive \
  "npm --prefix functions run test:emulator"
```

The `demo-estatia-ci` project ID is for local/emulated execution only. Never provide production credentials to emulator tests.

## Engineering expectations

- Keep domain and application logic independent of Firebase SDK implementations.
- Validate untrusted input at the transport boundary and enforce authorization on the server.
- Treat App Check as an additional abuse-control layer, never as a replacement for authentication or authorization.
- Keep private credentials in server-side Secret Manager bindings; do not return private secret material to clients.
- Make side-effecting operations idempotent where retries or duplicate delivery are possible.
- Use bounded timeouts and safe retry policies for network calls.
- Add unit tests for business rules and integration/contract tests for infrastructure boundaries.
- Avoid unrelated refactors in a feature or bug-fix pull request.
- Do not add production deployment steps or credentials to CI.

## Pull requests

Use the repository pull-request template. Describe compatibility implications for Android, iOS, and Web. Include exact verification commands and results; distinguish checks run locally from checks run by GitHub Actions.

A pull request should be small enough to review, include its tests and documentation, and link the relevant issue. Breaking API or data-contract changes require an explicit migration plan.

## Deployments

There is no automatic production deployment workflow. Any deployment must use an explicitly selected, reviewed Firebase project. Check the deployed function inventory, IAM bindings, Secret Manager bindings, Firestore/Storage policy and rollback plan before release.
