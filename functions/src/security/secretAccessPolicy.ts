import {HttpsError} from "firebase-functions/v2/https";

/**
 * Client applications must never receive values from Secret Manager.
 *
 * Secrets are consumed by trusted server-side integrations. There is
 * deliberately no client-readable Secret Manager allowlist in this policy.
 *
 * @param {string | undefined} uid Authenticated Firebase user ID, if present.
 */
export function denyClientSecretRead(uid: string | undefined): never {
  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Authentication is required to call this endpoint."
    );
  }

  throw new HttpsError(
    "permission-denied",
    "Secret Manager values are not available to client applications."
  );
}
