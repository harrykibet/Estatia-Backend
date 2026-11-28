const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  parsePropertyLikeRequest,
  PropertyLikeValidationError,
} = require("../../lib/properties/likePolicy");

describe("property like request contract", () => {
  it("accepts only a property ID and boolean like state", () => {
    assert.deepEqual(
      parsePropertyLikeRequest({
        propertyId: "property-123",
        liked: true,
      }),
      {
        propertyId: "property-123",
        liked: true,
      }
    );

    assert.deepEqual(
      parsePropertyLikeRequest({
        propertyId: "property-123",
        liked: false,
      }),
      {
        propertyId: "property-123",
        liked: false,
      }
    );
  });

  it("rejects caller-selected identity and additional fields", () => {
    assert.throws(
      () => parsePropertyLikeRequest({
        propertyId: "property-123",
        liked: true,
        uid: "another-user",
      }),
      PropertyLikeValidationError
    );
  });

  it("rejects invalid property document IDs", () => {
    for (const propertyId of [
      "",
      " property-123",
      "property-123 ",
      "properties/property-123",
      "x".repeat(129),
      null,
      123,
    ]) {
      assert.throws(
        () => parsePropertyLikeRequest({propertyId, liked: true}),
        PropertyLikeValidationError
      );
    }
  });

  it("rejects non-boolean like states and non-object payloads", () => {
    for (const liked of ["true", 1, null, undefined]) {
      assert.throws(
        () => parsePropertyLikeRequest({
          propertyId: "property-123",
          liked,
        }),
        PropertyLikeValidationError
      );
    }

    for (const input of [null, undefined, [], "like"]) {
      assert.throws(
        () => parsePropertyLikeRequest(input),
        PropertyLikeValidationError
      );
    }
  });
});
