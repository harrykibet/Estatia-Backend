import {getApps, initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {
  buildProfileMutation,
  ProfileValidationError,
} from "./profilePolicy";

/**
 * App Check remains mandatory in deployed environments.
 * The Functions Emulator has no attestation provider; disable only this
 * callable's App Check gate while executing inside the local emulator.
 */
const enforceAppCheck = process.env.FUNCTIONS_EMULATOR !== "true";

/**
 * Initializes the Admin SDK once per Functions runtime.
 */
if (getApps().length === 0) {
  initializeApp();
}

/**
 * Validates a user identifier and returns a confirmation result.
 */
export const validateUser = onCall(
  {
    enforceAppCheck,
  },
  async (request) => {
    const uid = request.data?.uid;
    if (typeof uid !== "string" || uid.trim().length === 0) {
      throw new Error("Missing uid");
    }

    return {uid, valid: true};
  }
);

/**
 * Synchronizes a user's public profile and private account attributes.
 *
 * The callable derives the UID from Firebase Authentication. Client payloads
 * may contain only displayName, profilePictureUrl, and bio. Email, phone and
 * email verification are taken from authenticated token claims. Role,
 * verification level, counters and other privileged fields are server-owned.
 */
export const syncUserProfile = onCall(
  {
    enforceAppCheck,
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError(
        "unauthenticated",
        "Authentication is required to update a profile."
      );
    }

    let mutation;
    try {
      mutation = buildProfileMutation(
        auth.uid,
        request.data,
        auth.token
      );
    } catch (error) {
      if (error instanceof ProfileValidationError) {
        throw new HttpsError("invalid-argument", error.message);
      }
      throw error;
    }

    const database = getFirestore();
    const privateUserRef = database.collection("users").doc(auth.uid);
    const publicProfileRef = database
      .collection("publicProfiles")
      .doc(auth.uid);

    await database.runTransaction(async (transaction) => {
      const [privateUserSnapshot, publicProfileSnapshot] = await Promise.all([
        transaction.get(privateUserRef),
        transaction.get(publicProfileRef),
      ]);

      const privateUserWrite = {
        ...mutation.privateProfile,
        updatedAt: FieldValue.serverTimestamp(),
        ...(!privateUserSnapshot.exists ? {
          createdAt: FieldValue.serverTimestamp(),
          userType: "TENANT",
          verificationLevel: "NONE",
          propertyCount: 0,
          followerCount: 0,
          followingCount: 0,
        } : {}),
      };

      const legacyUser = privateUserSnapshot.data() ?? {};
      const existingPublicProfile = publicProfileSnapshot.data() ?? {};
      const requestProfile = request.data as Record<string, unknown>;

      const publicProfileWrite: Record<string, unknown> = {
        ...mutation.publicProfile,
      };

      // Preserve an existing public choice when a sign-in bootstrap sends no
      // display edit. On first migration, use legacy display fields only; never
      // copy private or privileged fields from the mixed legacy user document.
      if (!Object.prototype.hasOwnProperty.call(requestProfile, "displayName")) {
        const existingName = existingPublicProfile.displayName;
        const legacyName = legacyUser.name;
        if (typeof existingName === "string") {
          publicProfileWrite.displayName = existingName;
        } else if (typeof legacyName === "string") {
          publicProfileWrite.displayName = legacyName;
        }
      }

      if (!Object.prototype.hasOwnProperty.call(requestProfile, "profilePictureUrl")) {
        const existingPicture = existingPublicProfile.profilePictureUrl;
        const legacyPicture = legacyUser.profilePictureUrl;
        if (typeof existingPicture === "string") {
          publicProfileWrite.profilePictureUrl = existingPicture;
        } else if (typeof legacyPicture === "string") {
          publicProfileWrite.profilePictureUrl = legacyPicture;
        }
      }

      if (!Object.prototype.hasOwnProperty.call(requestProfile, "bio")) {
        const existingBio = existingPublicProfile.bio;
        const legacyBio = legacyUser.bio;
        if (typeof existingBio === "string") {
          publicProfileWrite.bio = existingBio;
        } else if (typeof legacyBio === "string") {
          publicProfileWrite.bio = legacyBio;
        }
      }

      Object.assign(publicProfileWrite, {
        updatedAt: FieldValue.serverTimestamp(),
        ...(!publicProfileSnapshot.exists ? {
          createdAt: FieldValue.serverTimestamp(),
        } : {}),
      });

      transaction.set(privateUserRef, privateUserWrite, {merge: true});
      transaction.set(publicProfileRef, publicProfileWrite, {merge: true});
    });

    // Never return the private profile document to a client.
    return {
      uid: auth.uid,
      publicProfile: mutation.publicProfile,
    };
  }
);
