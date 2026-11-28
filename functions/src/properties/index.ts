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
