/**
 * Validated request for recording one property engagement event.
 */
export interface PropertyEngagementRequest {
  propertyId: string;
  eventId: string;
  eventType: "view" | "share";
}

/**
 * Validated request for submitting one property comment.
 */
export interface PropertyCommentRequest {
  propertyId: string;
  commentId: string;
  message: string;
}

/**
 * Error raised when an untrusted property interaction payload is invalid.
 */
export class PropertyInteractionValidationError extends Error {
  /**
   * Creates a validation error.
   * @param {string} message Validation failure.
   */
  constructor(message: string) {
    super(message);
    this.name = "PropertyInteractionValidationError";
  }
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROPERTY_ID_PATTERN = /^[^/\s]{1,128}$/;

/**
 * Checks whether a property document ID is valid.
 * @param {unknown} value Untrusted property ID.
 * @return {value is string} True when the ID is a valid path segment.
 */
function isValidPropertyId(value: unknown): value is string {
  return typeof value === "string" && PROPERTY_ID_PATTERN.test(value);
}

/**
 * Checks whether a request has exactly the supported fields.
 * @param {Record<string, unknown>} input Untrusted request object.
 * @param {string[]} allowedFields Supported field names.
 * @return {void} Throws when unsupported fields are present.
 */
function rejectUnexpectedFields(
  input: Record<string, unknown>,
  allowedFields: string[]
): void {
  const allowed = new Set(allowedFields);
  const unexpected = Object.keys(input).filter(
    (field) => !allowed.has(field)
  );
  if (unexpected.length > 0) {
    throw new PropertyInteractionValidationError(
      `Unsupported field(s): ${unexpected.sort().join(", ")}.`
    );
  }
}

/**
 * Parses a request for an idempotent view or share event.
 *
 * The authenticated UID is intentionally absent from the payload.
 *
 * @param {unknown} rawInput Untrusted callable request data.
 * @return {PropertyEngagementRequest} Validated engagement request.
 */
export function parsePropertyEngagementRequest(
  rawInput: unknown
): PropertyEngagementRequest {
  if (
    rawInput === null ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput)
  ) {
    throw new PropertyInteractionValidationError(
      "Engagement request must be an object."
    );
  }

  const input = rawInput as Record<string, unknown>;
  rejectUnexpectedFields(input, ["propertyId", "eventId", "eventType"]);

  if (!isValidPropertyId(input.propertyId)) {
    throw new PropertyInteractionValidationError(
      "propertyId must be a valid document ID."
    );
  }
  if (
    typeof input.eventId !== "string" ||
    !UUID_V4_PATTERN.test(input.eventId)
  ) {
    throw new PropertyInteractionValidationError(
      "eventId must be a UUID v4 idempotency key."
    );
  }
  if (input.eventType !== "view" && input.eventType !== "share") {
    throw new PropertyInteractionValidationError(
      "eventType must be view or share."
    );
  }

  return {
    propertyId: input.propertyId,
    eventId: input.eventId,
    eventType: input.eventType,
  };
}

/**
 * Parses a comment payload that contains no client-controlled author fields.
 *
 * @param {unknown} rawInput Untrusted callable request data.
 * @return {PropertyCommentRequest} Validated comment request.
 */
export function parsePropertyCommentRequest(
  rawInput: unknown
): PropertyCommentRequest {
  if (
    rawInput === null ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput)
  ) {
    throw new PropertyInteractionValidationError(
      "Comment request must be an object."
    );
  }

  const input = rawInput as Record<string, unknown>;
  rejectUnexpectedFields(input, ["propertyId", "commentId", "message"]);

  if (!isValidPropertyId(input.propertyId)) {
    throw new PropertyInteractionValidationError(
      "propertyId must be a valid document ID."
    );
  }
  if (
    typeof input.commentId !== "string" ||
    !UUID_V4_PATTERN.test(input.commentId)
  ) {
    throw new PropertyInteractionValidationError(
      "commentId must be a UUID v4 idempotency key."
    );
  }
  if (typeof input.message !== "string") {
    throw new PropertyInteractionValidationError(
      "message must be a string."
    );
  }

  const message = input.message.trim();
  if (message.length === 0 || message.length > 2000) {
    throw new PropertyInteractionValidationError(
      "message must contain between 1 and 2000 characters."
    );
  }

  return {
    propertyId: input.propertyId,
    commentId: input.commentId,
    message,
  };
}
