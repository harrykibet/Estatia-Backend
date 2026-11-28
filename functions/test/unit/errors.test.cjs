const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { AppError, NotFoundError } = require("../../lib/common/errors");

describe("application errors", () => {
  it("preserves the AppError name and message", () => {
    const error = new AppError("Invalid request");

    assert.ok(error instanceof Error);
    assert.equal(error.name, "AppError");
    assert.equal(error.message, "Invalid request");
  });

  it("keeps NotFoundError in the AppError hierarchy", () => {
    const error = new NotFoundError("Property not found");

    assert.ok(error instanceof AppError);
    assert.equal(error.name, "NotFoundError");
    assert.equal(error.message, "Property not found");
  });
});
