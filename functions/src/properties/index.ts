import {getApps, initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {
  parsePropertyLikeRequest,
  PropertyLikeValidationError,
} from "./likePolicy";

/**
 * App Check remains mandatory in deployed environments. The Functions
 * Emulator has no attestation provider, so only emulator calls bypass it.
 */
const enforceAppCheck = process.env.FUNCTIONS_EMULATOR !== "true";

if (getApps().length === 0) {
  initializeApp();
}

/**
 * Returns a placeholder property list.
 */
export const listProperties = onCall(
  {
    enforceAppCheck,
  },
  async () => {
    return {properties: []};
  }
);

/**
 * Sets the authenticated user's like state for one property.
 *
 * The user's UID is derived from Firebase Authentication. A transaction
 * maintains the property-side like, the user's liked-properties subcollection,
 * the legacy iOS likedProperties array (as a compatibility mirror only), and
 * the property aggregate count. Repeating the requested state is idempotent.
 */
/**
 * Migrates a bounded batch of legacy liked-property IDs into the canonical
 * user subcollection and property reverse index.
 *
 * The legacy array is read only from the authenticated user's private document.
 * Invalid IDs and references to deleted properties are removed from that
 * legacy array; only existing property documents become canonical likes.
 */
export const migrateLegacyPropertyLikes = onCall(
  {
    enforceAppCheck,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Authentication is required to migrate property likes."
      );
    }

    const uid = request.auth.uid;
    const database = getFirestore();
    const userRef = database.collection("users").doc(uid);

    return database.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists) {
        return {migrated: 0, processed: 0, remaining: 0};
      }

      const userData = userSnapshot.data() ?? {};
      const legacyValues = Array.isArray(userData.likedProperties) ?
        userData.likedProperties : [];
      const valuesToRemove = legacyValues.slice(0, 100);

      if (valuesToRemove.length === 0) {
        return {migrated: 0, processed: 0, remaining: 0};
      }

      const propertyIds = Array.from(new Set(
        valuesToRemove.filter((value): value is string => {
          if (typeof value !== "string") {
            return false;
          }
          try {
            parsePropertyLikeRequest({propertyId: value, liked: true});
            return true;
          } catch (error) {
            if (error instanceof PropertyLikeValidationError) {
              return false;
            }
            throw error;
          }
        })
      ));

      const records = propertyIds.map((propertyId) => {
        const propertyRef = database
          .collection("properties")
          .doc(propertyId);
        return {
          propertyId,
          propertyRef,
          propertyLikeRef: propertyRef.collection("likes").doc(uid),
          userLikeRef: userRef
            .collection("likedproperties")
            .doc(propertyId),
        };
      });

      const snapshots = await Promise.all(records.map(async (record) => ({
        property: await transaction.get(record.propertyRef),
        propertyLike: await transaction.get(record.propertyLikeRef),
        userLike: await transaction.get(record.userLikeRef),
      })));

      const countIncrements = new Map<string, number>();
      let migrated = 0;

      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const snapshot = snapshots[index];

        if (!snapshot.property.exists) {
          continue;
        }

        if (!snapshot.propertyLike.exists) {
          transaction.set(record.propertyLikeRef, {
            userId: uid,
            likedAt: FieldValue.serverTimestamp(),
          });
          countIncrements.set(
            record.propertyId,
            (countIncrements.get(record.propertyId) ?? 0) + 1
          );
        }

        if (!snapshot.userLike.exists) {
          transaction.set(record.userLikeRef, {
            propertyId: record.propertyId,
            likedAt: FieldValue.serverTimestamp(),
          });
        }

        migrated += 1;
      }

      for (const [propertyId, increment] of countIncrements) {
        const recordIndex = records.findIndex(
          (record) => record.propertyId === propertyId
        );
        const rawCount = snapshots[recordIndex].property.data()?.likesCount;
        const currentCount = (
          typeof rawCount === "number" &&
          Number.isSafeInteger(rawCount) &&
          rawCount >= 0
        ) ? rawCount : 0;
        transaction.update(records[recordIndex].propertyRef, {
          likesCount: currentCount + increment,
        });
      }

      transaction.set(userRef, {
        likedProperties: FieldValue.arrayRemove(...valuesToRemove),
      }, {merge: true});

      const remainingValues = legacyValues.filter(
        (value: unknown) => !valuesToRemove.includes(value)
      );

      return {
        migrated,
        processed: valuesToRemove.length,
        remaining: remainingValues.length,
      };
    });
  }
);

export const setPropertyLike = onCall(
  {
    enforceAppCheck,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Authentication is required to change a property like."
      );
    }

    let input;
    try {
      input = parsePropertyLikeRequest(request.data);
    } catch (error) {
      if (error instanceof PropertyLikeValidationError) {
        throw new HttpsError("invalid-argument", error.message);
      }
      throw error;
    }

    const uid = request.auth.uid;
    const database = getFirestore();
    const propertyRef = database
      .collection("properties")
      .doc(input.propertyId);
    const propertyLikeRef = propertyRef
      .collection("likes")
      .doc(uid);
    const userRef = database.collection("users").doc(uid);
    const userLikeRef = userRef
      .collection("likedproperties")
      .doc(input.propertyId);

    return database.runTransaction(async (transaction) => {
      const [
        propertySnapshot,
        propertyLikeSnapshot,
        userSnapshot,
        userLikeSnapshot,
      ] = await Promise.all([
        transaction.get(propertyRef),
        transaction.get(propertyLikeRef),
        transaction.get(userRef),
        transaction.get(userLikeRef),
      ]);

      if (!propertySnapshot.exists) {
        throw new HttpsError(
          "not-found",
          "The requested property does not exist."
        );
      }

      const property = propertySnapshot.data() ?? {};
      const rawCount = property.likesCount;
      let likesCount = (
        typeof rawCount === "number" &&
        Number.isSafeInteger(rawCount) &&
        rawCount >= 0
      ) ? rawCount : 0;

      if (input.liked) {
        if (!propertyLikeSnapshot.exists) {
          transaction.set(propertyLikeRef, {
            userId: uid,
            likedAt: FieldValue.serverTimestamp(),
          });
          likesCount += 1;
        }

        if (!userLikeSnapshot.exists) {
          transaction.set(userLikeRef, {
            propertyId: input.propertyId,
            likedAt: FieldValue.serverTimestamp(),
          });
        }

        if (userSnapshot.exists) {
          transaction.set(userRef, {
            likedProperties: FieldValue.arrayUnion([input.propertyId]),
          }, {merge: true});
        }
      } else {
        if (propertyLikeSnapshot.exists) {
          transaction.delete(propertyLikeRef);
          likesCount = Math.max(0, likesCount - 1);
        }

        if (userLikeSnapshot.exists) {
          transaction.delete(userLikeRef);
        }

        if (userSnapshot.exists) {
          transaction.set(userRef, {
            likedProperties: FieldValue.arrayRemove([input.propertyId]),
          }, {merge: true});
        }
      }

      if (
        (input.liked && !propertyLikeSnapshot.exists) ||
        (!input.liked && propertyLikeSnapshot.exists)
      ) {
        transaction.update(propertyRef, {likesCount});
      }

      return {
        propertyId: input.propertyId,
        liked: input.liked,
        likesCount,
      };
    });
  }
);
