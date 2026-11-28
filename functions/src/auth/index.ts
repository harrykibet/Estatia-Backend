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

      // Preserve existing public choices during sign-in bootstrap. When no
      // public profile exists, migrate only validated display fields from the
      // old mixed user document; never copy private or privileged attributes.
      const preserveOrMigrate = (
        field: "displayName" | "profilePictureUrl" | "bio",
        legacyField: "name" | "profilePictureUrl" | "bio",
        maxLength: number
      ) => {
        if (Object.prototype.hasOwnProperty.call(requestProfile, field)) {
          return;
        }

        const currentValue = existingPublicProfile[field];
        if (typeof currentValue === "string") {
          publicProfileWrite[field] = currentValue;
          return;
        }

        const legacyValue = legacyUser[legacyField];
        if (typeof legacyValue !== "string") {
          return;
        }

        const normalized = legacyValue.trim();
        if (normalized.length === 0 || normalized.length > maxLength) {
          return;
        }

        if (field === "profilePictureUrl") {
          try {
            const url = new URL(normalized);
            if (
              url.protocol !== "https:" ||
              url.hostname.length === 0 ||
              url.username.length > 0 ||
              url.password.length > 0
            ) {
              return;
            }
          } catch {
            return;
          }
        }

        publicProfileWrite[field] = normalized;
      };

      preserveOrMigrate("displayName", "name", 80);
      preserveOrMigrate("profilePictureUrl", "profilePictureUrl", 2048);
      preserveOrMigrate("bio", "bio", 500);

      // This is a user-declared display category, not an authorization role.
      // Only the three documented public values may be migrated from legacy
      // data; values such as ADMIN are never published or used for access.
      if (!Object.prototype.hasOwnProperty.call(requestProfile, "profileType")) {
        const existingType = existingPublicProfile.profileType;
        const legacyType = legacyUser.userType;
        if (
          typeof existingType === "string" &&
          ["TENANT", "AGENT", "PROPERTY_OWNER"].includes(existingType)
        ) {
          publicProfileWrite.profileType = existingType;
        } else if (
          typeof legacyType === "string" &&
          ["TENANT", "AGENT", "PROPERTY_OWNER"].includes(legacyType)
        ) {
          publicProfileWrite.profileType = legacyType;
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
