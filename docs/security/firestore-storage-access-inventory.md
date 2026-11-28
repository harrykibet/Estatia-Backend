# Firestore and Storage access inventory

**Audit date:** 2026-11-28  
**Tracking issue:** [Backend #2](https://github.com/harrykibet/Estatia-Backend/issues/2)

This document records the access patterns visible in the current Android, iOS, Web, and Backend source trees. It is an inventory and migration plan, **not an approved production ruleset**. It deliberately does not infer authorization from a client-provided role or identifier.

## Executive finding

The repositories do not yet share one consistent Firestore/Storage contract. The current clients have direct write paths that need tightening, and some of those paths conflict with one another. Adding rules now without changing the clients would either break existing workflows or require grants that are too broad.

The backend repository currently has an empty `firestore.rules`, an empty `firestore.indexes.json`, and an empty `storage.rules.txt`. Its `firebase.json` configures only the Functions emulator; it does not bind Firestore rules/indexes or Storage rules. The Storage filename is also not the Firebase CLI default `storage.rules`. No production rules are deployed or changed by this inventory.

## Observed Firestore access

| Path | Observed client operations | Security implications |
| --- | --- | --- |
| `properties/{propertyId}` | Android reads feeds, searches, nearby results and individual properties; creates, updates and deletes properties. iOS has a Firestore adapter for property reads and implements create/update/delete. The current iOS app container explicitly selects that adapter for Home; Search and Profile use no-op adapters. Web reads the collection with `getDocs`. | Public marketplace reads may be required, but that product decision must be explicit. Writes must bind `ownerId` to the authenticated UID, keep ownership immutable and protect server/derived fields. |
| `properties/{propertyId}/contact/info` | Android writes the separate contact document in the property creation batch and attempts to read it independently. A permission-denied read is handled as an expected condition. | Contact data is intended to be more restricted than the public listing. Do not place this path under the same public-read rule as the property document. Define who may read it (owner, authenticated lead/contact workflow, or another explicit policy). |
| `properties/{propertyId}/likes/{uid}` | Android writes and deletes a like document keyed by the acting user's UID. | A caller must not create or delete a like for another UID. |
| `users/{uid}/likedproperties/{propertyId}` | Android mirrors likes under the user's document and updates the property `likesCount` in the same batch. | The paired like records and count need atomic consistency checks or a server-owned mutation endpoint. A rule that independently permits arbitrary count changes is unsafe. |
| `properties/{propertyId}/comments/{commentId}` | Android creates comments and increments `commentsCount` in one batch; it also streams comments ordered by `timeStamp`. | Create must bind `authorId` to the authenticated UID, validate message and timestamp fields, and prevent arbitrary count changes. No client update/delete operation was found in the inspected adapter. |
| `users/{uid}` | Android reads user documents and uses `SetOptions.merge()` to create/update a profile. The model includes name, email, phone, picture, bio, `userType`, `verificationLevel`, liked properties and follower/property counters. iOS has a Firestore adapter that reads, updates and deletes user documents, and stores favourites in a `likedProperties` array. The current iOS Profile route is wired to a no-op user adapter. | Private profile fields should not automatically become readable by every authenticated user. Self-service profile updates must not change verification state, role/partner status, or server-maintained counters. A document ID must match `request.auth.uid`. |
| `analytics` | Android declares this collection name, but the inspected `FirestoreAnalytics` implementation writes to Firebase Analytics and does not read/write a Firestore collection. | Do not grant access merely because a collection-name constant exists. No Firestore analytics policy is justified by the inspected implementation. |

The `ownedproperties` subcollection name is also declared in Android constants, but no read/write use was found in the inspected production adapters. It is not included as an authorized path until a concrete consumer and schema exist.

### Field-level concerns

Firestore Security Rules authorize a document read as a whole; they do not redact selected fields from the returned document. Because the current user model combines public-looking profile attributes with email and phone fields, use separate private `users/{uid}` and allowlisted `publicProfiles/{uid}` documents if other users need to see a profile. Do not expose the existing mixed user document merely to render an owner's name or avatar.


1. Android's `UserType` includes `TENANT`, `AGENT`, and `PROPERTY_OWNER`; `VerificationLevel` includes `NONE`, `IDENTITY_VERIFIED`, and `TRUSTED_PARTNER`. The Android user-profile write serializes a `UserEntityModel` containing both `userType` and `verificationLevel`. These values are supplied by client-side models; they are not proof of role or verification. Rules must not treat a client-writable field as an administrative claim.
2. Android's property model includes `ownerId`, `viewsCount`, `sharesCount`, `likesCount`, `commentsCount`, and a transient `matchScore`. The current adapter increments views and shares by directly updating the parent property document, without recording a per-user event or deduplication key. Direct counter writes would permit manipulation if broadly allowed.
3. Android's `PropertyEntityModel` contains a `contact` property, while the upload path separately writes the supplied contact object to `contact/info`. The parent property is serialized as a whole in the same operation. Confirm with a focused serialization test that contact data cannot also be written into the public parent document; otherwise remove it from the public serialization shape.
4. The Android user-profile writer accepts both a path `userId` and a user object. Rules must require the path UID to equal the authenticated UID and validate that any embedded `userId` agrees. It must not permit changes to role, verification or count fields.
5. Comment author names and property owner names are supplied in client models. They are display data, not identity proof. At minimum, the authoritative UID must be validated; consider deriving trusted display names from profiles/server logic.

## Observed Storage access

The inspected Android property uploader writes objects to:

- `properties/{propertyId}/images/{generatedId}`
- `properties/{propertyId}/videos/{generatedId}`

It calls `putFile(uri)` without Storage custom metadata. More importantly, it uploads all media **before** creating the parent `properties/{propertyId}` Firestore document. Therefore a Storage rule that authorizes uploads by looking up the parent property's `ownerId` will reject the current upload sequence.

The Android emulator integration test also writes a synthetic `ci_backend_probe/{uid}/round-trip.bin` object. This is test-only behavior and must not become a production exception in the rules.

No iOS Firebase Storage upload implementation or Web Storage client use was found in the inspected source tree. Do not infer additional Storage paths without a concrete call site.

### Required media migration before owner-bound Storage writes

Choose and test one design before adding production upload grants:

- Create an owner-bound draft property before uploading, then upload beneath that existing property and finalize its media fields; define cleanup/rollback for abandoned drafts and partial uploads; or
- Move uploads into a UID-scoped path (for example, `users/{uid}/properties/{propertyId}/...`) and have a trusted backend validate and associate those objects with the property.

In either design, validate object size, content type, allowed media types, create-vs-overwrite behavior, owner identity and delete semantics. Do not trust a caller-supplied UID in object metadata unless the rule also compares it with `request.auth.uid` and the object path/ownership lifecycle is coherent.

## Cross-platform schema mismatches

These are concrete differences in the current adapters/models and must be resolved or explicitly supported before the rules are treated as a shared contract:

- **Favourites:** Android uses `properties/{id}/likes/{uid}` plus `users/{uid}/likedproperties/{propertyId}`; iOS uses `users/{uid}.likedProperties`.
- **Contact information:** Android writes `properties/{id}/contact/info`; the iOS `PropertyModel` exposes `contactPhone` and `contactEmail` on the property model itself.
- **Media fields:** Android's property model uses `imageUrl`, `directVideoUrls`, and `hlsUrl`; the iOS model additionally carries the older `videoUrl` field.
- **Creation time:** Android's model exposes `createdAt` as a millisecond `Long`; iOS decodes either an integer millisecond value or a Date.

A single rule document cannot safely paper over these schema differences. Prefer one documented canonical schema and deliberate migration adapters over granting arbitrary field sets indefinitely.

## Proposed authorization principles (not yet implemented)

| Resource | Candidate policy | Still required before approval |
| --- | --- | --- |
| Public property document | Public read only if the marketplace is intended to expose listings without sign-in; otherwise authenticated read. | Confirm product visibility, moderation/status semantics and whether inactive listings are public. |
| Property create/update/delete | Authenticated owner only; create requires `ownerId == request.auth.uid`; update cannot change owner ID or server-managed counters/derived fields; delete owner only. | Ensure every client assigns the authenticated UID, align create/update field schemas and decide moderation controls. |
| Property contact document | Not public by default; owner read/write. | Specify the authorized lead/contact workflow and whether verified tenants may read it. |
| User profile | Read only the fields actually needed by another user's public profile; private PII remains self/server-only. Self updates are limited to an allowlist. | Separate public profile data from email/phone and define profile visibility. |
| User role and verification | Server-only changes; never trust `userType` or `verificationLevel` supplied by the client as authorization. | Define trusted verification/admin process and, if needed, Firebase custom claims maintained by trusted server code. |
| Likes/favourites | Only the authenticated user may mutate their own favourite; paired writes and counters must be atomic and constrained. | Canonicalize the two competing representations or migrate all clients to one server-mediated contract. |
| Comments | Authenticated create for self; validate author UID, property ID, non-empty bounded message and timestamp. Read policy follows property visibility. | Define moderation, edit/delete and anti-spam policy. |
| Views/shares/aggregate counters | Prefer server-mediated, rate-limited, deduplicated mutations; do not grant arbitrary client increments. | Add callable/API endpoints or a rules-verifiable event model and migrate Android. |
| Property media | Public read only for media attached to visible listings; owner-bound create/delete with strict type/size limits. | Complete the upload lifecycle migration above. |

No agent/admin authority should be inferred from a profile string. If the product needs privileged actors, establish their authority through trusted custom claims or another backend-verified entitlement and test it independently.

## Emulator verification required

Before rules are wired into the deployable Firebase configuration, add positive and negative Firestore **and** Storage Emulator tests for at least:

- Anonymous and unrelated authenticated users cannot read private user/contact data.
- A user cannot create a property with another user's `ownerId`, transfer ownership, edit/delete another user's property, or change protected counters/derived fields.
- A user cannot change their own role, verification level, property/follower counts, or another user's profile.
- A user cannot create/delete another user's like or mutate aggregate counts without the corresponding permitted operation.
- Comment author spoofing, cross-property writes, malformed/oversized messages and unauthenticated writes are denied.
- Storage uploads without auth, outside permitted paths, with spoofed ownership, invalid MIME types or excessive size are denied; authorized owner uploads and intended public reads succeed.
- Test-only emulator paths do not create production rules exceptions.

Tests must use synthetic project identities/data and require no production credentials. They must assert both allowed behavior and denied behavior. Required Firestore composite indexes should be derived from the final query inventory and checked in alongside the rules.

## Rollout gate

The rules/index files remain empty and unconfigured in this change. Do not deploy rules based on this inventory. The next implementation step is to reconcile the client contracts above (especially contact privacy, client-controlled roles/counters, favourite representation and Storage upload ordering), then add rules with emulator tests and only then wire those validated files into `firebase.json`.

No production Firebase project was queried, mutated or deployed as part of this source audit.
