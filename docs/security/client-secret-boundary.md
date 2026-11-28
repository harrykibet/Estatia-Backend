# Client and Server Secret Boundary

## Policy

Firebase Secret Manager values are server-side credentials. Android, iOS, and Web clients must not be able to retrieve arbitrary Secret Manager values, even when they provide a valid Firebase Authentication token or App Check attestation.

App Check is an app/device attestation and abuse-control signal. It is not permission to disclose a secret. Authentication establishes a user identity; it does not grant access to backend credentials.

## Current remediation

The legacy callable `getSecret` is retained temporarily under its existing exported name to avoid deleting a potentially deployed Cloud Function during this security change. It now:

- Rejects unauthenticated calls with `UNAUTHENTICATED`.
- Rejects authenticated client calls with `PERMISSION_DENIED`.
- Does not instantiate or call the Secret Manager service.
- Keeps App Check enforcement enabled in deployed environments.
- Disables only App Check enforcement inside the Functions Emulator, where client attestation is not configured.

The callable returns no secret value for any caller. The emulator tests cover the unauthenticated endpoint and the pure authorization policy for authenticated identities.

## Server-side use

Trusted server-side integrations may retrieve only the secrets they need, through server-side adapters and narrowly scoped service identities. Do not pass client-controlled Secret Manager resource names into these adapters. Prefer explicit secret bindings and configuration per function over broad project-wide Secret Manager access.

Never return secret values, tokens, private keys, or provider credentials from a callable, HTTP route, event response, log, metric, crash report, or client-facing error.

## Client configuration

Some configuration values are intentionally public because a client SDK requires them (for example, Firebase project configuration or a payment provider's publishable key). Public configuration is not a Secret Manager secret. It should be:
- Classified and documented explicitly.
- Distributed through the platform's normal build-time configuration mechanism or a narrow, versioned public-configuration endpoint.
- Restricted at the provider where possible (package/bundle ID, signing certificate, API scope, referrer, quota, and allowed origins).
- Free of private API keys, payment secret keys, OAuth client secrets, service-account material, or unrestricted provider credentials.

A publishable key is not interchangeable with a secret API key. Do not infer key type from a variable or Secret Manager name; confirm the actual provider credential before migration.

## Compatibility and retirement

The Android repository currently contains an unused-looking remote secret-fetching abstraction. Its Retrofit method declares `GET /getSecret`, while this backend export is a Firebase callable endpoint (callable POST protocol). No production call site was found in the repository search performed during this audit. iOS and Web repository searches found no matching consumer.

This mismatch is tracked separately for Android cleanup. Do not remove the legacy callable export until:
1. The deployed Cloud Functions inventory is inspected in the intended Firebase project.
2. Logs/metrics and external integrations have been checked for consumers not represented in the four source repositories.
3. Potentially exposed credentials are assessed and rotated where necessary.
4. The Android legacy abstraction has been removed or migrated to a legitimate public-configuration contract.

See [Backend issue #1](https://github.com/harrykibet/Estatia-Backend/issues/1).
