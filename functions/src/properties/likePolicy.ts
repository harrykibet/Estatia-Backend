/**
 * Validated request for a user's property-like state transition.
 */
export interface PropertyLikeRequest {
  propertyId: string;
  liked: boolean;
}

/**
 * Error raised when a like transition payload violates its contract.
 */
export class PropertyLikeValidationError extends Error {
  /**
   * Creates a validation error.
   * @param {string} message Validation failure.
   */
  constructor(message: string) {
    super(message);
    this.name = "PropertyLikeValidationError";
  }
}

const ALLOWED_FIELDS = new Set(["propertyId", "liked"]);

/**
 * Parses an untrusted property-like request.
 *
 * The authenticated UID is deliberately not part of the payload; the
 * callable derives the actor from Firebase Authentication.
 *
 * @param {unknown} rawInput Untrusted callable request data.
 * @return {PropertyLikeRequest} Validated state transition.
 */
export function parsePropertyLikeRequest(
  rawInput: unknown
): PropertyLikeRequest {
  if (
    rawInput === null ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput)
  ) {
    throw new PropertyLikeValidationError(
      "Like request must be an object."
    );
  }

  const input = rawInput as Record<string, unknown>;
  const unexpectedFields = Object.keys(input).filter(
    (field) => !ALLOWED_FIELDS.has(field)
  );

  if (unexpectedFields.length > 0) {
    throw new PropertyLikeValidationError(
      `Unsupported like field(s): ${unexpectedFields.sort().join(", ")}.`
    );
  }

  if (
    typeof input.propertyId !== "string" ||
    input.propertyId.trim() !== input.propertyId ||
    input.propertyId.length === 0 ||
    input.propertyId.length > 128 ||
    input.propertyId.includes("/")
  ) {
    throw new PropertyLikeValidationError(
      "propertyId must be a valid non-empty document ID."
    );
  }

  if (typeof input.liked !== "boolean") {
    throw new PropertyLikeValidationError(
      "liked must be a boolean."
    );
  }

  return {
    propertyId: input.propertyId,
    liked: input.liked,
  };
}
