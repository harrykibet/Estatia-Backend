import {onCall} from "firebase-functions/v2/https";
import {denyClientSecretRead} from "./secretAccessPolicy";

/**
 * Deprecated compatibility endpoint.
 *
 * Keep the callable name temporarily so an existing deployed function is
 * updated in place instead of being deleted as part of this security change.
 * It fails closed for every caller and never accesses Secret Manager.
 *
 * Remove this export only after the deployed-function inventory and all
 * external client integrations have been reviewed.
 */
const enforceAppCheck = process.env.FUNCTIONS_EMULATOR !== "true";

export const getSecret = onCall(
  {
    enforceAppCheck,
  },
  async (request) => denyClientSecretRead(request.auth?.uid)
);
