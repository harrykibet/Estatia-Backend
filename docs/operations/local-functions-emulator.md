# Local Functions Emulator

## Scope

The repository currently configures the Firebase Cloud Functions emulator only. Firestore and Storage emulators are not enabled because the checked-in Firestore rules, indexes, and Storage rules are empty and the current client read/write model has not yet been inventoried.

Do not treat this as a substitute for Firestore/Storage rules testing. Track that work in [issue #2](https://github.com/harrykibet/Estatia-Backend/issues/2).

## Prerequisites

- Node.js 24.
- npm.
- Firebase CLI 15.37.0 (the CI command pins this version).

Install the Functions dependencies:

```bash
npm ci --prefix functions
```

## Run a local callable smoke test

From the repository root:

```bash
npx --yes firebase-tools@15.37.0 emulators:exec \
  --project demo-estatia-ci \
  --only functions \
  --non-interactive \
  "npm --prefix functions run test:emulator"
```

The test invokes the existing `validateUser` callable through the local Functions emulator. The emulator project ID is synthetic and the test must not use production credentials.

## Start the emulator interactively

```bash
npm --prefix functions run serve
```

The Functions emulator listens on port 5001. To connect an application, configure its Firebase Functions SDK to use the local emulator endpoint.

## Safety constraints

- Never pass a production project ID to emulator commands.
- Do not supply service-account credentials or production secrets to emulator tests.
- Mock M-Pesa, Secret Manager, and other external side effects in unit/integration tests.
- Keep emulator exports and test fixtures synthetic and free of personal data.
- Do not deploy Firestore/Storage rules until the authorization matrix and client compatibility tests are approved.
