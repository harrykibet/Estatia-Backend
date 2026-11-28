# Server-authoritative property likes

## Canonical representation

The authenticated user's liked-property index is:

`users/{uid}/likedproperties/{propertyId}`

Each property also has a reverse index:

`properties/{propertyId}/likes/{uid}`

The user-side subcollection is the canonical source for fetching a user's saved/liked property IDs. The property-side subcollection supports per-property liker lookup. Both are written only by the trusted `setPropertyLike` callable. The top-level property `likesCount` is maintained in the same Firestore transaction.

The legacy iOS `users/{uid}.likedProperties` array is temporarily mirrored by the callable for backward compatibility with the existing iOS adapter. It is not an independent write source and will be removed after client read migrations are complete.

## Callable contract

`setPropertyLike({ propertyId, liked })`

- Requires Firebase Authentication.
- Requires App Check outside the Functions Emulator.
- Derives the acting UID from the authenticated token; a caller-supplied UID is rejected as an unknown field.
- Validates a non-empty property document ID (max 128 characters; no slash or surrounding whitespace) and a boolean `liked`.
- Requires the property document to exist.
- Applies the transition transactionally to both like indexes and `likesCount`.
- Uses state comparison to make repeated like/unlike requests idempotent.
- Decrements counts no lower than zero.
- Updates the legacy iOS array mirror only when the private user document already exists, so a like cannot create a partial `users/{uid}` document that bypasses new-user profile defaults.

## Client migration

Android's Firebase property adapter calls this callable instead of writing either like subcollection or `likesCount` directly. Its existing read path continues to read `users/{uid}/likedproperties`.

iOS writes through the same callable. Its legacy array read remains compatible during rollout; the callable mirrors updates into that array while also maintaining the canonical subcollection. The array read will be retired in a later client migration after a backfill has been verified.

## Limits

This contract covers likes/favorites only. Views, shares and comments still have separate client mutation paths and need their own server-authoritative, idempotent contracts before Firestore rules can prohibit all direct client counter writes. This change adds no Firestore rules and does not deploy any production resource.
