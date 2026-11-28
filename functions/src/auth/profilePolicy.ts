/**
 * Client-editable public profile fields.
 *
 * Private contact attributes are sourced from verified Firebase Auth token
 * claims. Role, verification, ownership, and aggregate fields are never
 * accepted from a client profile payload.
 */
export interface PublicProfileInput {
  displayName?: string;
  profilePictureUrl?: string | null;
  bio?: string | null;
  /** Public display category only; never an authorization claim. */
  profileCategory?: "TENANT" | "AGENT" | "PROPERTY_OWNER";
  /** @deprecated Transitional alias for older mobile clients. */
  profileType?: "TENANT" | "AGENT" | "PROPERTY_OWNER";
}

/**
 * Claims supplied by Firebase Authentication.
 */
export interface AuthProfileClaims {
  email?: unknown;
  phone_number?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
}

/**
 * The two documents written by the trusted profile synchronization path.
 */
export interface ProfileMutation {
  publicProfile: Record<string, string | null>;
  privateProfile: Record<string, string | boolean>;
}

/**
 * Error raised when a client profile payload violates the field contract.
 */
export class ProfileValidationError extends Error {
  /**
   * Creates a validation error.
   * @param {string} message Validation failure.
   */
  constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

const ALLOWED_PROFILE_FIELDS = new Set([
  "displayName",
  "profilePictureUrl",
  "bio",
  "profileCategory",
  "profileType",
]);

const PUBLIC_PROFILE_CATEGORIES = new Set([
  "TENANT",
  "AGENT",
  "PROPERTY_OWNER",
]);

/**
 * Builds strictly allowlisted public and private profile updates.
 *
 * Public profile data contains only display-safe attributes. Email and phone
 * are copied from the verified Firebase Auth token, never from request data.
 *
 * @param {string} uid Authenticated Firebase UID.
 * @param {unknown} rawInput Untrusted callable request data.
 * @param {AuthProfileClaims} claims Verified Firebase Auth token claims.
 * @return {ProfileMutation} Safe document patches for the two profile stores.
 */
export function buildProfileMutation(
  uid: string,
  rawInput: unknown,
  claims: AuthProfileClaims
): ProfileMutation {
  if (typeof uid !== "string" || uid.trim().length === 0) {
    throw new ProfileValidationError("Authenticated user ID is required.");
  }

  if (
    rawInput === null ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput)
  ) {
    throw new ProfileValidationError("Profile data must be an object.");
  }

  const input = rawInput as Record<string, unknown>;
  const unexpectedFields = Object.keys(input).filter(
    (field) => !ALLOWED_PROFILE_FIELDS.has(field)
  );
  if (unexpectedFields.length > 0) {
    throw new ProfileValidationError(
      `Unsupported profile field(s): ${unexpectedFields.sort().join(", ")}.`
    );
  }

  const publicProfile: Record<string, string | null> = {uid};

  if (Object.prototype.hasOwnProperty.call(input, "displayName")) {
    publicProfile.displayName = normalizeDisplayName(input.displayName);
  } else {
    const claimName = safeClaimString(claims.name, 80);
    if (claimName) {
      publicProfile.displayName = claimName;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "profilePictureUrl")) {
    publicProfile.profilePictureUrl = normalizeProfilePictureUrl(
      input.profilePictureUrl
    );
  } else {
    const claimPicture = safeClaimUrl(claims.picture);
    if (claimPicture) {
      publicProfile.profilePictureUrl = claimPicture;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "bio")) {
    publicProfile.bio = normalizeBio(input.bio);
  }

  const hasProfileCategory = Object.prototype.hasOwnProperty.call(
    input,
    "profileCategory"
  );
  const hasLegacyProfileType = Object.prototype.hasOwnProperty.call(
    input,
    "profileType"
  );
  if (hasProfileCategory && hasLegacyProfileType) {
    throw new ProfileValidationError(
      "Specify profileCategory only; profileType is a legacy alias."
    );
  }
  if (hasProfileCategory) {
    publicProfile.profileCategory = normalizeProfileCategory(input.profileCategory);
  } else if (hasLegacyProfileType) {
    // Keep existing app versions working during rollout. The alias is mapped
    // to the same presentation-only field and is never used for authorization.
    publicProfile.profileCategory = normalizeProfileCategory(input.profileType);
  }

  const privateProfile: Record<string, string | boolean> = {uid};
  const email = safeClaimString(claims.email, 320);
  const phoneNumber = safeClaimString(claims.phone_number, 32);

  if (email) {
    privateProfile.email = email;
  }
  if (phoneNumber) {
    privateProfile.phoneNumber = phoneNumber;
  }
  if (typeof claims.email_verified === "boolean") {
    privateProfile.emailVerified = claims.email_verified;
  }

  return {publicProfile, privateProfile};
}

/**
 * Validates a public, self-declared display category.
 *
 * It is presentation-only and must never be used to authorize privileged actions.
 *
 * @param {unknown} value Untrusted public profile category.
 * @return {"TENANT" | "AGENT" | "PROPERTY_OWNER"} Allowed display category.
 */
function normalizeProfileCategory(
  value: unknown
): "TENANT" | "AGENT" | "PROPERTY_OWNER" {
  if (
    typeof value !== "string" ||
    !PUBLIC_PROFILE_CATEGORIES.has(value)
  ) {
    throw new ProfileValidationError(
      "profileCategory must be TENANT, AGENT, or PROPERTY_OWNER."
    );
  }

  return value as "TENANT" | "AGENT" | "PROPERTY_OWNER";
}

/**
 * Validates and normalizes a user-selected display name.
 * @param {unknown} value Untrusted display name.
 * @return {string} Trimmed display name.
 */
function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProfileValidationError("displayName must be a string.");
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 80) {
    throw new ProfileValidationError(
      "displayName must contain between 1 and 80 characters."
    );
  }

  return normalized;
}

/**
 * Validates a public profile picture URL, allowing null to clear the value.
 * @param {unknown} value Untrusted profile-picture URL.
 * @return {string | null} Validated HTTPS URL or null.
 */
function normalizeProfilePictureUrl(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ProfileValidationError(
      "profilePictureUrl must be an HTTPS URL or null."
    );
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 2048) {
    throw new ProfileValidationError(
      "profilePictureUrl must contain between 1 and 2048 characters."
    );
  }

  try {
    const url = new URL(normalized);
    if (
      url.protocol !== "https:" ||
      url.hostname.length === 0 ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      throw new Error("Invalid profile URL.");
    }
  } catch {
    throw new ProfileValidationError(
      "profilePictureUrl must be a valid HTTPS URL."
    );
  }

  return normalized;
}

/**
 * Validates a user-editable public bio.
 * @param {unknown} value Untrusted biography.
 * @return {string | null} Trimmed biography or null.
 */
function normalizeBio(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ProfileValidationError("bio must be a string or null.");
  }
  if (value.length > 500) {
    throw new ProfileValidationError("bio must not exceed 500 characters.");
  }

  return value.trim();
}

/**
 * Safely extracts a bounded string from a verified Auth token claim.
 * @param {unknown} value Token claim value.
 * @param {number} maxLength Maximum permitted length.
 * @return {string | undefined} Normalized claim string when valid.
 */
function safeClaimString(
  value: unknown,
  maxLength: number
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    return undefined;
  }
  return normalized;
}

/**
 * Accepts only a safe HTTPS picture URL from Auth token claims.
 * @param {unknown} value Token picture claim.
 * @return {string | undefined} HTTPS picture URL when valid.
 */
function safeClaimUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      value.length <= 2048
    ) {
      return value;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
