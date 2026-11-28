# Public and private user profile contract

**Status:** implementation proposal under review. The source changes and Emulator tests do not deploy or mutate a production Firebase project.

## Document boundary

| Document | Allowed content | Authority |
| --- | --- | --- |
| `publicProfiles/{uid}` | `uid`, `displayName`, `profilePictureUrl`, `bio`, `profileCategory`, `createdAt`, `updatedAt` | Public presentation only |
| `users/{uid}` | Auth-derived email/phone/email-verification state plus account state, server-managed `userType`, verification state, counters, favourites and other private account data | Private account state; role/verification/counters are server-controlled |

`profileCategory` may be `TENANT`, `AGENT`, or `PROPERTY_OWNER`. It is self-declared display data only. It must never be consulted by Firestore/Storage rules, privileged Functions, payment logic, moderation, or other authorization decisions. The private `users/{uid}.userType` and any custom claims are separate server-controlled authority.

## Callable write path

`syncUserProfile` derives the UID from Firebase Authentication and writes the private/public documents in one transaction. Email, phone and email-verification state come from Auth token claims, never from request data. Client-controlled role, verification and aggregate fields are rejected.

New clients send `profileCategory`. The backend temporarily accepts the legacy `profileType` field as a backward-compatible alias and maps it into `profileCategory`; it never persists `profileType`. Supplying both keys in one request is rejected. Remove the alias only in a later compatibility window after old mobile versions are no longer supported.

The public document is replaced with its allowlisted shape on every successful synchronization. This avoids leaving old private fields in an already-existing `publicProfiles/{uid}` document.

## Legacy public-profile sanitation

The one-time migration utility scans the existing `publicProfiles` collection and:
- preserves already-valid public display values;
- migrates legacy public `profileType` into `profileCategory`;
- fills missing display values from the corresponding legacy private `users/{uid}` document only after validation;
- never copies email, phone, private role, verification state, counters, favourites, or arbitrary fields;
- does not derive `profileCategory` from private `users/{uid}.userType`.

The migration script requires an explicit Firebase project ID and runs read-only by default. Example commands (replace the placeholder with the verified target project):

```sh
npm --prefix functions run migrate:public-profiles -- --project <verified-project-id>
npm --prefix functions run migrate:public-profiles -- --project <verified-project-id> --apply
```

The first command is a dry run. The second performs writes and must only be run after reviewing the dry-run counts, confirming the project ID and obtaining the normal production change approval. The script uses Application Default Credentials and logs document counts, not profile values.

This PR does not run the script against production. The target Firebase project must first be reconciled across the Backend, Android, iOS and Web repositories.

## Verification

- Unit tests verify the allowlist, validation and migration transformation.
- Auth/Firestore Emulator tests verify the callable transaction, legacy compatibility, rejection of role escalation, stale-public-field removal, and migration dry-run/apply behavior.
- No production Firestore records, Auth accounts, Functions or rules are changed by CI.
