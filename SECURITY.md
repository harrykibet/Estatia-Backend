# Security Policy

## Reporting a vulnerability

Do not publish exploit details, credentials, tokens, personal data, or production resource identifiers in a public issue.

Use GitHub's private vulnerability reporting / Security Advisories feature for this repository when available. Include the affected component, impact, prerequisites, and a safe reproduction outline. If private reporting is unavailable, contact the repository owner through a private GitHub channel and request a secure reporting route.

Please allow the maintainers to assess and coordinate remediation before public disclosure.

## Security expectations

- Never commit service-account keys, API credentials, payment-provider secrets, signing material, App Check debug tokens, or production data.
- Client applications are untrusted environments. App Check is not user authentication or resource authorization.
- Never expose arbitrary Secret Manager lookup or return private backend credentials to a client.
- Authenticate callers and authorize each operation against the requested resource.
- Validate all untrusted input on the server.
- Treat payment and webhook handlers as untrusted, retryable, and potentially duplicated inputs.
- Keep CI credentials least-privileged; pull-request verification must not need production Firebase credentials.
- Use emulators and synthetic data for automated tests.

## Current known security work

The following open issues track security-sensitive work discovered during the initial repository audit:

- [#1 — Client-accessible Secret Manager retrieval and secret API contract](https://github.com/harrykibet/Estatia-Backend/issues/1).
- [#2 — Firestore and Storage authorization rules](https://github.com/harrykibet/Estatia-Backend/issues/2).

The existence of these issues means the affected paths require review; it does not mean the risks have been remediated.
