const assert = require("node:assert/strict");
const { test } = require("node:test");

const callableBaseUrl =
  process.env.FUNCTIONS_EMULATOR_BASE_URL ??
  "http://127.0.0.1:5001/demo-estatia-ci/us-central1";

test("validateUser callable responds through the Functions emulator", async () => {
  const response = await fetch(`${callableBaseUrl}/validateUser`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: {
        uid: "ci-smoke-user",
      },
    }),
  });

  const responseBody = await response.json();

  assert.equal(
    response.status,
    200,
    `Expected callable success, received HTTP ${response.status}: ${JSON.stringify(responseBody)}`
  );
  assert.deepEqual(responseBody.result, {
    uid: "ci-smoke-user",
    valid: true,
  });
});
