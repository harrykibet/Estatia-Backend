const assert = require("node:assert/strict");
const { test } = require("node:test");

test("Firebase Admin Realtime Database entrypoint loads from a clean install", () => {
  const database = require("firebase-admin/database");

  assert.equal(typeof database.getDatabase, "function");
});
