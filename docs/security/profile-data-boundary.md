# Public and private user profile boundary

## Canonical document split

The first profile-security implementation introduces two documents keyed by the authenticated Firebase UID:

- `publicProfiles/{uid}`: only display-safe attributes (`uid`, `displayName`, `profilePictureUrl`, `bio`, `createdAt`, `updatedAt`). This is the candidate source for public profile rendering.
- `users/{uid}`: private account attributes (including Auth-derived `email`, `phoneNumber`, and `emailVerified`) and server-maintained account state. This document is not a public profile document.

Firestore rules authorize an entire document read; they do not redact individual fields. Keeping both categories in one document cannot provide field-level privacy.

## Trusted write contract

The callable `syncUserProfile` is the only new write path in this slice. It:

1. Requires Firebase Authentication and uses `request.auth.uid`; it does not accept a client-selected UID.
2. Enforces App Check in deployed environments. Only the Functions Emulator bypasses the attestation gate for local testing.
3. Accepts only `displayName`, `profilePictureUrl`, and `bio` from the client.
4. Validates display name length (1–80), bio length (0–500), and HTTPS-only profile picture URLs (max 2048).
5. Sources email, phone number and email-verification state from Firebase Auth token claims, not request fields.
6. Creates default `TENANT` / `NONE` state and zeroed counters for a new private user document. Existing role/verification values are preserved by this callable, not trusted for authorization, and require a separate legacy-data audit/reconciliation before the rules migration.
7. Writes the private and public documents atomically in one Firestore transaction.
8. Returns only the public profile patch; private account data is never included in the callable response.

The function rejects unknown fields rather than silently ignoring them. In particular, callers cannot submit `uid`, email, phone number, `userType`, `verificationLevel`, role claims, or account counters.

## Migration limitations

This is the backend contract slice, not the complete client migration:

- Android's existing `FirebaseAuthService.createOrUpdateUserProfile()` still writes the legacy `users/{uid}` document directly until the Android adapter is migrated.
- The iOS Firebase user adapter still writes the legacy user document directly and its app profile route is currently wired to a no-op adapter.
- Existing mixed `users/{uid}` documents are not backfilled or scrubbed by this callable.
- Existing property documents, contact subcollections, favourites and Storage objects are unchanged.
- This change does not add or deploy Firestore rules. It does not make legacy direct client writes safe by itself.

The next client PRs must call `syncUserProfile`, read public display data from `publicProfiles/{uid}`, and stop sending user-controlled role, verification, email or phone fields. After client migrations, add explicit rules and Emulator tests for public profile reads and self-only private user access.

## Verification

Unit tests cover input allowlisting, URL and length validation, Auth-claim separation, and protected-field rejection. Functions/Auth/Firestore Emulator integration tests verify authentication, atomic document creation, private/public field separation, default state, and rejection of attempted role/verification escalation. No production Firebase project is modified.
