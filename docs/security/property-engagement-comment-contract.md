# Server-authoritative property engagement and comments

## Property views and shares

The `recordPropertyEngagement` callable accepts:

```json
{
  "propertyId": "property-document-id",
  "eventId": "client-generated-uuid-v4",
  "eventType": "view"
}
```

The supported event types are `view` and `share`. The callable derives the acting UID from Firebase Authentication and requires App Check outside the Functions Emulator.

The event document is stored at:

`properties/{propertyId}/engagementEvents/{eventId}`

The event and the matching aggregate counter are committed in one Firestore transaction. Replaying an identical event ID, user, and type does not increment the counter again. Reusing the key for another user or event type is rejected. Clients must generate the idempotency UUID once per logical view/share action and reuse it for retries.

This provides request-level idempotency, not a product-level "one view per person" policy. A new deliberate view generates a new event ID and may increment the count again.

## Comments

The `submitPropertyComment` callable accepts only `propertyId`, a client-generated UUID v4 `commentId`, and `message`. It derives:
- `authorId` from Firebase Authentication.
- `authorName` from `publicProfiles/{uid}.displayName`, with a generic fallback.
- `timeStamp` from server runtime time.

The comment is written to `properties/{propertyId}/comments/{commentId}` and `commentsCount` is incremented transactionally. Repeating the same comment ID and same author/message is idempotent; reusing it with different content or another author is rejected.

Message content is trimmed, must be non-empty, and is limited to 2,000 characters. Client-supplied author IDs, display names, and timestamps are rejected.

## Client migration

Android must generate each UUID once outside its retry block and use the two callables instead of direct counter/comment writes. Comment streams can continue reading the existing subcollection and use the same `timeStamp` number field.

The callable does not yet define comment edit/delete/moderation or abuse-rate limits. Those need separate policy before comments are opened to broad anonymous or unauthenticated access.

No Firestore rules are changed or deployed by this contract.
