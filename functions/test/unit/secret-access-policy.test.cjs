const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { HttpsError } = require("firebase-functions/v2/https");
const { denyClientSecretRead } = require("../../lib/security/secretAccessPolicy");

describe("client Secret Manager access policy", () => {
  it("rejects unauthenticated requests", () => {
    assert.throws(
      () => denyClientSecretRead(undefined),
      (error) => {
        assert.ok(error instanceof HttpsError);
        assert.equal(error.code, "unauthenticated");
        return true;
      }
    );
  });

  it("rejects authenticated clients because secrets are server-only", () => {
    assert.throws(
      () => denyClientSecretRead("synthetic-ci-user"),
      (error) => {
        assert.ok(error instanceof HttpsError);
        assert.equal(error.code, "permission-denied");
        assert.match(error.message, /not available to client applications/);
        return true;
      }
    );
  });
});
