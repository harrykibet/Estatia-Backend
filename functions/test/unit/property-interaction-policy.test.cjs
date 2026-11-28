const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  parsePropertyCommentRequest,
  parsePropertyEngagementRequest,
  PropertyInteractionValidationError,
} = require("../../lib/properties/interactionPolicy");

describe("property engagement request contract", () => {
  it("accepts valid view and share events", () => {
    const eventId = "550e8400-e29b-41d4-a716-446655440000";
    assert.deepEqual(
      parsePropertyEngagementRequest({
        propertyId: "property-1",
        eventId,
        eventType: "view",
      }),
      {propertyId: "property-1", eventId, eventType: "view"}
    );
    assert.deepEqual(
      parsePropertyEngagementRequest({
        propertyId: "property-1",
        eventId,
        eventType: "share",
      }),
      {propertyId: "property-1", eventId, eventType: "share"}
    );
  });

  it("rejects identity, counter and unsupported engagement fields", () => {
    assert.throws(
      () => parsePropertyEngagementRequest({
        propertyId: "property-1",
        eventId: "550e8400-e29b-41d4-a716-446655440000",
        eventType: "view",
        uid: "another-user",
      }),
      PropertyInteractionValidationError
    );
  });

  it("rejects invalid identifiers and event types", () => {
    for (const propertyId of ["", "a/b", " a", "a ".repeat(70)]) {
      assert.throws(
        () => parsePropertyEngagementRequest({
          propertyId,
          eventId: "550e8400-e29b-41d4-a716-446655440000",
          eventType: "view",
        }),
        PropertyInteractionValidationError
      );
    }
    assert.throws(
      () => parsePropertyEngagementRequest({
        propertyId: "property-1",
        eventId: "not-a-uuid",
        eventType: "view",
      }),
      PropertyInteractionValidationError
    );
    assert.throws(
      () => parsePropertyEngagementRequest({
        propertyId: "property-1",
        eventId: "550e8400-e29b-41d4-a716-446655440000",
        eventType: "delete",
      }),
      PropertyInteractionValidationError
    );
  });
});

describe("property comment request contract", () => {
  it("accepts and trims a comment payload", () => {
    const commentId = "550e8400-e29b-41d4-a716-446655440001";
    assert.deepEqual(
      parsePropertyCommentRequest({
        propertyId: "property-1",
        commentId,
        message: "  Is this still available?  ",
      }),
      {
        propertyId: "property-1",
        commentId,
        message: "Is this still available?",
      }
    );
  });

  it(
    "rejects client-supplied author identity, display name and timestamp",
    () => {
    assert.throws(
      () => parsePropertyCommentRequest({
        propertyId: "property-1",
        commentId: "550e8400-e29b-41d4-a716-446655440001",
        message: "Hello",
        authorId: "another-user",
        authorName: "Trusted Person",
        timeStamp: 1,
      }),
        PropertyInteractionValidationError
      );
    }
  );

  it("rejects empty and oversized comment messages", () => {
    for (const message of ["", "   ", "x".repeat(2001), null]) {
      assert.throws(
        () => parsePropertyCommentRequest({
          propertyId: "property-1",
          commentId: "550e8400-e29b-41d4-a716-446655440001",
          message,
        }),
        PropertyInteractionValidationError
      );
    }
  });
});
