import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {
  parsePropertyCommentRequest,
  parsePropertyEngagementRequest,
  PropertyInteractionValidationError,
} from "./interactionPolicy";

const enforceAppCheck = process.env.FUNCTIONS_EMULATOR !== "true";

/**
 * Converts an untrusted interaction payload into a typed callable error.
 * @param {unknown} error Error thrown while validating interaction input.
 */
function throwInteractionValidation(error: unknown): never {
  if (error instanceof PropertyInteractionValidationError) {
    throw new HttpsError("invalid-argument", error.message);
  }
  throw error;
}

/**
 * Records a view or share using a client-generated UUID v4 idempotency key.
 *
 * The UID is taken from Firebase Authentication. The event document and
 * aggregate count are committed together, so transport retries with the same
 * key cannot inflate the counter.
 */
export const recordPropertyEngagement = onCall(
  {enforceAppCheck},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Authentication is required to record property engagement."
      );
    }

    let input: ReturnType<typeof parsePropertyEngagementRequest>;
    try {
      input = parsePropertyEngagementRequest(request.data);
    } catch (error) {
      throwInteractionValidation(error);
    }

    const uid = request.auth.uid;
    const database = getFirestore();
    const propertyRef = database.collection("properties").doc(input.propertyId);
    const eventRef = propertyRef
      .collection("engagementEvents")
      .doc(input.eventId);
    const counterField = input.eventType === "view" ?
      "viewsCount" : "sharesCount";

    return database.runTransaction(async (transaction) => {
      const [propertySnapshot, eventSnapshot] = await Promise.all([
        transaction.get(propertyRef),
        transaction.get(eventRef),
      ]);

      if (!propertySnapshot.exists) {
        throw new HttpsError(
          "not-found",
          "The requested property does not exist."
        );
      }

      if (eventSnapshot.exists) {
        const event = eventSnapshot.data() ?? {};
        if (event.uid !== uid || event.eventType !== input.eventType) {
          throw new HttpsError(
            "already-exists",
            "The engagement idempotency key is already in use."
          );
        }

        const existingCount = propertySnapshot.get(counterField);
        return {
          propertyId: input.propertyId,
          eventType: input.eventType,
          recorded: false,
          count: typeof existingCount === "number" ? existingCount : 0,
        };
      }

      const currentValue = propertySnapshot.get(counterField);
      const currentCount = (
        typeof currentValue === "number" &&
        Number.isSafeInteger(currentValue) &&
        currentValue >= 0
      ) ? currentValue : 0;
      const count = currentCount + 1;

      transaction.create(eventRef, {
        eventId: input.eventId,
        uid,
        eventType: input.eventType,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(propertyRef, {[counterField]: count});

      return {
        propertyId: input.propertyId,
        eventType: input.eventType,
        recorded: true,
        count,
      };
    });
  }
);

/**
 * Creates a property comment and increments commentsCount transactionally.
 *
 * Author identity and display name are server-derived. A UUID v4 commentId
 * makes retries idempotent without allowing a caller to select an author UID,
 * author name, or timestamp.
 */
export const submitPropertyComment = onCall(
  {enforceAppCheck},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Authentication is required to submit a comment."
      );
    }

    let input: ReturnType<typeof parsePropertyCommentRequest>;
    try {
      input = parsePropertyCommentRequest(request.data);
    } catch (error) {
      throwInteractionValidation(error);
    }

    const uid = request.auth.uid;
    const database = getFirestore();
    const propertyRef = database.collection("properties").doc(input.propertyId);
    const publicProfileRef = database.collection("publicProfiles").doc(uid);
    const commentRef = propertyRef
      .collection("comments")
      .doc(input.commentId);

    return database.runTransaction(async (transaction) => {
      const [propertySnapshot, profileSnapshot, commentSnapshot] =
        await Promise.all([
          transaction.get(propertyRef),
          transaction.get(publicProfileRef),
          transaction.get(commentRef),
        ]);

      if (!propertySnapshot.exists) {
        throw new HttpsError(
          "not-found",
          "The requested property does not exist."
        );
      }

      if (commentSnapshot.exists) {
        const existing = commentSnapshot.data() ?? {};
        if (
          existing.authorId !== uid ||
          existing.message !== input.message ||
          existing.propertyId !== input.propertyId
        ) {
          throw new HttpsError(
            "already-exists",
            "The comment idempotency key is already in use."
          );
        }

        const existingCount = propertySnapshot.get("commentsCount");
        return {
          commentId: input.commentId,
          created: false,
          commentsCount: typeof existingCount === "number" ?
            existingCount : 0,
        };
      }

      const profile = profileSnapshot.data() ?? {};
      const displayName = typeof profile.displayName === "string" &&
        profile.displayName.trim().length > 0 ?
        profile.displayName.trim().slice(0, 80) : "Estatia user";
      const rawCount = propertySnapshot.get("commentsCount");
      const currentCount = (
        typeof rawCount === "number" &&
        Number.isSafeInteger(rawCount) &&
        rawCount >= 0
      ) ? rawCount : 0;
      const commentsCount = currentCount + 1;

      transaction.create(commentRef, {
        id: input.commentId,
        authorId: uid,
        authorName: displayName,
        message: input.message,
        propertyId: input.propertyId,
        timeStamp: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(propertyRef, {commentsCount});

      return {
        commentId: input.commentId,
        created: true,
        commentsCount,
      };
    });
  }
);
