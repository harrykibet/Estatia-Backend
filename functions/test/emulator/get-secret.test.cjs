const assert = require("node:assert/strict");
const { test } = require("node:test");

const callableBaseUrl =
  process.env.FUNCTIONS_EMULATOR_BASE_URL ??
  "http://127.0.0.1:5001/demo-estatia-ci/us-central1";

test("getSecret fails closed and does not return Secret Manager values", async () => {
  const response = await fetch(`${callableBaseUrl}/getSecret`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: {
        secretId: "synthetic-private-secret",
      },
    }),
  });

  const responseBody = await response.json();

  assert.equal(
    response.status,
    401,
    `Expected unauthenticated rejection, received HTTP ${response.status}: ${JSON.stringify(responseBody)}`
  );
  assert.equal(responseBody.error?.status, "UNAUTHENTICATED");
  assert.equal("result" in responseBody, false);
  assert.equal(JSON.stringify(responseBody).includes("synthetic-private-secret"), false);
});
