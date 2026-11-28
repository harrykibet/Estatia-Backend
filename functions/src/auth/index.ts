import {onCall} from "firebase-functions/v2/https";

/**
 * App Check remains mandatory in deployed environments.
 * The Functions Emulator has no attestation provider; disable only this
 * callable's App Check gate while executing inside the local emulator.
 */
const enforceAppCheck = process.env.FUNCTIONS_EMULATOR !== "true";

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
