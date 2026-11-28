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
  const email = `property-like-${randomUUID()}@example.test`;
  const password = `CiOnly-${randomUUID()}-Aa9!`;
  const response = await fetch(
    `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${authApiKey}`,
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

async function callSetPropertyLike(data, idToken) {
  const response = await fetch(`${callableBaseUrl}/setPropertyLike`, {
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
    `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:delete?key=${authApiKey}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({idToken}),
    }
  );
}

test("setPropertyLike is authenticated, idempotent and maintains paired state and count", async () => {
  const unauthenticated = await callSetPropertyLike({
    propertyId: "property-without-auth",
    liked: true,
  });
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error?.status, "UNAUTHENTICATED");

  const primary = await createSyntheticUser();
  const secondary = await createSyntheticUser();
  const adminApp = initializeApp(
    {projectId},
    `property-like-contract-${randomUUID()}`
  );
  const database = getFirestore(adminApp);
  const propertyId = `property-${randomUUID()}`;
  const propertyRef = database.collection("properties").doc(propertyId);
  const primaryUserRef = database.collection("users").doc(primary.localId);
  const primaryPropertyLikeRef = propertyRef
    .collection("likes")
    .doc(primary.localId);
  const primaryUserLikeRef = primaryUserRef
    .collection("likedproperties")
    .doc(propertyId);
  const secondaryUserLikeRef = database
    .collection("users")
    .doc(secondary.localId)
    .collection("likedproperties")
    .doc(propertyId);

  try {
    await Promise.all([
      propertyRef.set({
        title: "Synthetic emulator property",
        likesCount: 0,
      }),
      primaryUserRef.set({
        uid: primary.localId,
        userType: "TENANT",
        likedProperties: [],
      }),
    ]);

    const invalid = await callSetPropertyLike({
      propertyId,
      liked: true,
      uid: secondary.localId,
    }, primary.idToken);
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error?.status, "INVALID_ARGUMENT");

    const firstLike = await callSetPropertyLike({
      propertyId,
      liked: true,
    }, primary.idToken);
    assert.equal(firstLike.response.status, 200);
    assert.equal(firstLike.body.result.liked, true);
    assert.equal(firstLike.body.result.likesCount, 1);

    const [afterFirstLike, propertyLike, userLike, userAfterLike] =
      await Promise.all([
        propertyRef.get(),
        primaryPropertyLikeRef.get(),
        primaryUserLikeRef.get(),
        primaryUserRef.get(),
      ]);
    assert.equal(afterFirstLike.data().likesCount, 1);
    assert.equal(propertyLike.exists, true);
    assert.equal(userLike.exists, true);
    assert.deepEqual(userAfterLike.data().likedProperties, [propertyId]);

    const repeatedLike = await callSetPropertyLike({
      propertyId,
      liked: true,
    }, primary.idToken);
    assert.equal(repeatedLike.response.status, 200);
    assert.equal(repeatedLike.body.result.likesCount, 1);

    const otherUserUnlike = await callSetPropertyLike({
      propertyId,
      liked: false,
    }, secondary.idToken);
    assert.equal(otherUserUnlike.response.status, 200);
    assert.equal(otherUserUnlike.body.result.likesCount, 1);
    assert.equal((await propertyRef.get()).data().likesCount, 1);
    assert.equal(await secondaryUserLikeRef.get().then((snap) => snap.exists), false);

    const firstUnlike = await callSetPropertyLike({
      propertyId,
      liked: false,
    }, primary.idToken);
    assert.equal(firstUnlike.response.status, 200);
    assert.equal(firstUnlike.body.result.likesCount, 0);

    const [afterUnlike, propertyLikeAfterUnlike, userLikeAfterUnlike, userAfterUnlike] =
      await Promise.all([
        propertyRef.get(),
        primaryPropertyLikeRef.get(),
        primaryUserLikeRef.get(),
        primaryUserRef.get(),
      ]);
    assert.equal(afterUnlike.data().likesCount, 0);
    assert.equal(propertyLikeAfterUnlike.exists, false);
    assert.equal(userLikeAfterUnlike.exists, false);
    assert.deepEqual(userAfterUnlike.data().likedProperties, []);

    const repeatedUnlike = await callSetPropertyLike({
      propertyId,
      liked: false,
    }, primary.idToken);
    assert.equal(repeatedUnlike.response.status, 200);
    assert.equal(repeatedUnlike.body.result.likesCount, 0);

    const missingProperty = await callSetPropertyLike({
      propertyId: `missing-${randomUUID()}`,
      liked: true,
    }, primary.idToken);
    assert.equal(missingProperty.response.status, 404);
    assert.equal(missingProperty.body.error?.status, "NOT_FOUND");
  } finally {
    await Promise.all([
      propertyRef.delete(),
      primaryUserRef.delete(),
      primaryPropertyLikeRef.delete(),
      primaryUserLikeRef.delete(),
      secondaryUserLikeRef.delete(),
    ]);
    try {
      await Promise.all([
        deleteSyntheticUser(primary.idToken),
        deleteSyntheticUser(secondary.idToken),
      ]);
    } finally {
      await deleteApp(adminApp);
    }
  }
});


test("migrateLegacyPropertyLikes moves old favourites to canonical indexes", async () => {
  const user = await createSyntheticUser();
  const adminApp = initializeApp(
    {projectId},
    `legacy-likes-contract-${randomUUID()}`
  );
  const database = getFirestore(adminApp);
  const userRef = database.collection("users").doc(user.localId);
  const validPropertyId = `legacy-property-${randomUUID()}`;
  const missingPropertyId = `missing-property-${randomUUID()}`;
  const propertyRef = database.collection("properties").doc(validPropertyId);
  const propertyLikeRef = propertyRef.collection("likes").doc(user.localId);
  const userLikeRef = userRef
    .collection("likedproperties")
    .doc(validPropertyId);

  try {
    await Promise.all([
      userRef.set({
        uid: user.localId,
        userType: "TENANT",
        likedProperties: [
          validPropertyId,
          validPropertyId,
          missingPropertyId,
          "invalid/property/id",
        ],
      }),
      propertyRef.set({
        title: "Legacy favorite property",
        likesCount: 4,
      }),
    ]);

    const unauthenticated = await fetch(
      `${callableBaseUrl}/migrateLegacyPropertyLikes`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({data: {}}),
      }
    );
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(
      `${callableBaseUrl}/migrateLegacyPropertyLikes`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.idToken}`,
        },
        body: JSON.stringify({data: {}}),
      }
    );
    const body = await response.json();
    assert.equal(
      response.status,
      200,
      `Legacy likes migration failed: ${JSON.stringify(body)}`
    );
    assert.deepEqual(body.result, {
      migrated: 1,
      processed: 4,
      remaining: 0,
    });

    const [property, propertyLike, userLike, userSnapshot] =
      await Promise.all([
        propertyRef.get(),
        propertyLikeRef.get(),
        userLikeRef.get(),
        userRef.get(),
      ]);
    assert.equal(property.data().likesCount, 5);
    assert.equal(propertyLike.exists, true);
    assert.equal(userLike.exists, true);
    assert.deepEqual(userSnapshot.data().likedProperties, []);

    const repeat = await fetch(
      `${callableBaseUrl}/migrateLegacyPropertyLikes`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.idToken}`,
        },
        body: JSON.stringify({data: {}}),
      }
    );
    assert.deepEqual((await repeat.json()).result, {
      migrated: 0,
      processed: 0,
      remaining: 0,
    });
    assert.equal((await propertyRef.get()).data().likesCount, 5);
  } finally {
    await Promise.all([
      userRef.delete(),
      propertyRef.delete(),
      propertyLikeRef.delete(),
      userLikeRef.delete(),
    ]);
    try {
      await deleteSyntheticUser(user.idToken);
    } finally {
      await deleteApp(adminApp);
    }
  }
});
