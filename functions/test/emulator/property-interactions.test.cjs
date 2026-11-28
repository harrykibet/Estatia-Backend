const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const {test} = require("node:test");
const {deleteApp, initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

const projectId = process.env.GCLOUD_PROJECT ?? "demo-estatia-ci";
const authEmulatorHost =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const callableBaseUrl =
  process.env.FUNCTIONS_EMULATOR_BASE_URL ??
  `http://127.0.0.1:5001/${projectId}/us-central1`;
const authApiKey = "demo-api-key";

async function createSyntheticUser() {
  const email = `property-interactions-${randomUUID()}@example.test`;
  const password = `CiOnly-${randomUUID()}-Aa9!`;
  const response = await fetch(
    "http://" + authEmulatorHost +
      "/identitytoolkit.googleapis.com/v1/accounts:signUp" +
      "?key=" + authApiKey,
    {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    }
  );
  const body = await response.json();
  assert.equal(
    response.status,
    200,
    `Auth Emulator sign-up failed: ${JSON.stringify(body)}`
  );
  return body;
}

async function callFunction(name, data, idToken) {
  const response = await fetch(`${callableBaseUrl}/${name}`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? {Authorization: `Bearer ${idToken}`} : {}),
    },
    body: JSON.stringify({data}),
  });
  return {response, body: await response.json()};
}

async function deleteSyntheticUser(idToken) {
  await fetch(
    "http://" + authEmulatorHost +
      "/identitytoolkit.googleapis.com/v1/accounts:delete" +
      "?key=" + authApiKey,
    {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({idToken}),
    }
  );
}

test("recordPropertyEngagement is authenticated and idempotent", async () => {
  const unauthenticated = await callFunction(
    "recordPropertyEngagement",
    {
      propertyId: "property-no-auth",
      eventId: randomUUID(),
      eventType: "view",
    }
  );
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error?.status, "UNAUTHENTICATED");

  const user = await createSyntheticUser();
  const other = await createSyntheticUser();
  const adminApp = initializeApp(
    {projectId},
    `property-engagement-${randomUUID()}`
  );
  const database = getFirestore(adminApp);
  const propertyId = `property-${randomUUID()}`;
  const propertyRef = database.collection("properties").doc(propertyId);
  const eventId = randomUUID();
  const eventRef = propertyRef.collection("engagementEvents").doc(eventId);

  try {
    await propertyRef.set({viewsCount: 0, sharesCount: 0});

    const forgedUid = await callFunction(
      "recordPropertyEngagement",
      {
        propertyId,
        eventId: randomUUID(),
        eventType: "view",
        uid: other.localId,
      },
      user.idToken
    );
    assert.equal(forgedUid.response.status, 400);
    assert.equal(forgedUid.body.error?.status, "INVALID_ARGUMENT");

    const first = await callFunction(
      "recordPropertyEngagement",
      {propertyId, eventId, eventType: "view"},
      user.idToken
    );
    assert.equal(first.response.status, 200);
    assert.equal(first.body.result.recorded, true);
    assert.equal(first.body.result.count, 1);

    const repeat = await callFunction(
      "recordPropertyEngagement",
      {propertyId, eventId, eventType: "view"},
      user.idToken
    );
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.body.result.recorded, false);
    assert.equal(repeat.body.result.count, 1);

    const duplicateKey = await callFunction(
      "recordPropertyEngagement",
      {propertyId, eventId, eventType: "share"},
      user.idToken
    );
    assert.equal(duplicateKey.response.status, 409);
    assert.equal(duplicateKey.body.error?.status, "ALREADY_EXISTS");

    const otherOwnerReuse = await callFunction(
      "recordPropertyEngagement",
      {propertyId, eventId, eventType: "view"},
      other.idToken
    );
    assert.equal(otherOwnerReuse.response.status, 409);

    const share = await callFunction(
      "recordPropertyEngagement",
      {propertyId, eventId: randomUUID(), eventType: "share"},
      user.idToken
    );
    assert.equal(share.response.status, 200);
    assert.equal(share.body.result.count, 1);

    const [property, event] = await Promise.all([
      propertyRef.get(),
      eventRef.get(),
    ]);
    assert.equal(property.data().viewsCount, 1);
    assert.equal(property.data().sharesCount, 1);
    assert.equal(event.data().uid, user.localId);
    assert.equal(event.data().eventType, "view");
  } finally {
    await propertyRef.delete();
    await eventRef.delete();
    try {
      await Promise.all([
        deleteSyntheticUser(user.idToken),
        deleteSyntheticUser(other.idToken),
      ]);
    } finally {
      await deleteApp(adminApp);
    }
  }
});

test(
  "submitPropertyComment derives author details and increments count once",
  async () => {
  const unauthenticated = await callFunction(
    "submitPropertyComment",
    {
      propertyId: "property-no-auth",
      commentId: randomUUID(),
      message: "Hello",
    }
  );
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error?.status, "UNAUTHENTICATED");

  const user = await createSyntheticUser();
  const other = await createSyntheticUser();
  const adminApp = initializeApp(
    {projectId},
    `property-comment-${randomUUID()}`
  );
  const database = getFirestore(adminApp);
  const propertyId = `property-${randomUUID()}`;
  const propertyRef = database.collection("properties").doc(propertyId);
  const profileRef = database.collection("publicProfiles").doc(user.localId);
  const commentId = randomUUID();
  const commentRef = propertyRef.collection("comments").doc(commentId);

  try {
    await Promise.all([
      propertyRef.set({commentsCount: 0}),
      profileRef.set({
        uid: user.localId,
        displayName: "Verified Display Name",
      }),
    ]);

    const spoofed = await callFunction(
      "submitPropertyComment",
      {
        propertyId,
        commentId: randomUUID(),
        message: "Hello",
        authorId: other.localId,
        authorName: "Admin",
        timeStamp: 123,
      },
      user.idToken
    );
    assert.equal(spoofed.response.status, 400);
    assert.equal(spoofed.body.error?.status, "INVALID_ARGUMENT");

    const first = await callFunction(
      "submitPropertyComment",
      {propertyId, commentId, message: "  Is this still available?  "},
      user.idToken
    );
    assert.equal(first.response.status, 200);
    assert.equal(first.body.result.created, true);
    assert.equal(first.body.result.commentsCount, 1);

    const repeat = await callFunction(
      "submitPropertyComment",
      {propertyId, commentId, message: "Is this still available?"},
      user.idToken
    );
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.body.result.created, false);
    assert.equal(repeat.body.result.commentsCount, 1);

    const comment = await commentRef.get();
    const property = await propertyRef.get();
    assert.equal(comment.data().authorId, user.localId);
    assert.equal(comment.data().authorName, "Verified Display Name");
    assert.equal(comment.data().message, "Is this still available?");
    assert.equal(typeof comment.data().timeStamp, "number");
    assert.equal(property.data().commentsCount, 1);
  } finally {
    await Promise.all([
      propertyRef.delete(),
      profileRef.delete(),
      commentRef.delete(),
    ]);
    try {
      await Promise.all([
        deleteSyntheticUser(user.idToken),
        deleteSyntheticUser(other.idToken),
      ]);
    } finally {
      await deleteApp(adminApp);
    }
  }
});
