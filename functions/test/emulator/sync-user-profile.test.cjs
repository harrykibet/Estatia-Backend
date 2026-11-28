const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { deleteApp, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const projectId = process.env.GCLOUD_PROJECT ?? "demo-estatia-ci";
const authEmulatorHost =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const callableBaseUrl =
  process.env.FUNCTIONS_EMULATOR_BASE_URL ??
  `http://127.0.0.1:5001/${projectId}/us-central1`;
const authApiKey = "demo-api-key";

async function callSyncUserProfile(data, idToken) {
  const response = await fetch(`${callableBaseUrl}/syncUserProfile`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  return {
    response,
    body: await response.json(),
  };
}

test("syncUserProfile authenticates and separates public/private profile documents", async () => {
  const unauthenticated = await callSyncUserProfile({
    displayName: "Should Not Be Written",
  });
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error?.status, "UNAUTHENTICATED");

  const email = `profile-${randomUUID()}@example.test`;
  const password = `CiOnly-${randomUUID()}-Aa9!`;
  const signUpResponse = await fetch(
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
  const signUpBody = await signUpResponse.json();
  assert.equal(
    signUpResponse.status,
    200,
    `Auth Emulator sign-up failed: ${JSON.stringify(signUpBody)}`
  );
  assert.equal(typeof signUpBody.localId, "string");
  assert.equal(typeof signUpBody.idToken, "string");

  const adminApp = initializeApp(
    {projectId},
    `profile-contract-${randomUUID()}`
  );
  const database = getFirestore(adminApp);
  const userRef = database.collection("users").doc(signUpBody.localId);
  const publicProfileRef = database.collection("publicProfiles").doc(signUpBody.localId);

  try {
    const accepted = await callSyncUserProfile(
      {
        displayName: "Synthetic Profile",
        bio: "A profile created by the emulator contract test.",
        profileCategory: "AGENT",
      },
      signUpBody.idToken
    );
    assert.equal(
      accepted.response.status,
      200,
      `Profile sync failed: ${JSON.stringify(accepted.body)}`
    );
    assert.equal(accepted.body.result.uid, signUpBody.localId);
    assert.equal(
      accepted.body.result.publicProfile.displayName,
      "Synthetic Profile"
    );
    assert.equal("email" in accepted.body.result.publicProfile, false);
    assert.equal("phoneNumber" in accepted.body.result.publicProfile, false);

    const [privateSnapshot, publicSnapshot] = await Promise.all([
      userRef.get(),
      publicProfileRef.get(),
    ]);
    assert.equal(privateSnapshot.exists, true);
    assert.equal(publicSnapshot.exists, true);

    const privateProfile = privateSnapshot.data();
    const publicProfile = publicSnapshot.data();

    assert.equal(privateProfile.uid, signUpBody.localId);
    assert.equal(privateProfile.email, email);
    assert.equal(privateProfile.userType, "TENANT");
    assert.equal(privateProfile.verificationLevel, "NONE");
    assert.equal(privateProfile.propertyCount, 0);
    assert.equal(privateProfile.followerCount, 0);
    assert.equal(privateProfile.followingCount, 0);

    assert.equal(publicProfile.uid, signUpBody.localId);
    assert.equal(publicProfile.displayName, "Synthetic Profile");
    assert.equal(
      publicProfile.bio,
      "A profile created by the emulator contract test."
    );
    assert.equal(publicProfile.profileCategory, "AGENT");
    assert.equal("profileType" in publicProfile, false);

    // Older mobile clients still send profileType during the staged rollout.
    const legacyClient = await callSyncUserProfile(
      {profileType: "PROPERTY_OWNER"},
      signUpBody.idToken
    );
    assert.equal(
      legacyClient.response.status,
      200,
      `Legacy profile category sync failed: ${JSON.stringify(legacyClient.body)}`
    );
    const migratedPublicProfile = (await publicProfileRef.get()).data();
    assert.equal(migratedPublicProfile.profileCategory, "PROPERTY_OWNER");
    assert.equal("profileType" in migratedPublicProfile, false);
    assert.equal("email" in publicProfile, false);
    assert.equal("phoneNumber" in publicProfile, false);
    assert.equal("verificationLevel" in publicProfile, false);
    assert.equal("followerCount" in publicProfile, false);

    const rejected = await callSyncUserProfile(
      {
        displayName: "Attempted Role Escalation",
        userType: "PROPERTY_OWNER",
        verificationLevel: "TRUSTED_PARTNER",
        followerCount: 1,
      },
      signUpBody.idToken
    );
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.error?.status, "INVALID_ARGUMENT");

    const [privateAfterRejectedWrite, publicAfterRejectedWrite] =
      await Promise.all([userRef.get(), publicProfileRef.get()]);
    assert.equal(
      privateAfterRejectedWrite.data().userType,
      "TENANT",
      "A rejected client payload must not change server-owned role state."
    );
    assert.equal(
      privateAfterRejectedWrite.data().verificationLevel,
      "NONE"
    );
    assert.equal(
      publicAfterRejectedWrite.data().displayName,
      "Synthetic Profile",
      "A rejected client payload must not partially update the public profile."
    );
  } finally {
    await Promise.all([userRef.delete(), publicProfileRef.delete()]);
    try {
      await fetch(
        `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:delete?key=${authApiKey}`,
        {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({idToken: signUpBody.idToken}),
        }
      );
    } finally {
      await deleteApp(adminApp);
    }
  }
});


test("syncUserProfile migrates only legacy display fields to publicProfiles", async () => {
  const email = `legacy-profile-${randomUUID()}@example.test`;
  const password = `CiOnly-${randomUUID()}-Aa9!`;
  const signUpResponse = await fetch(
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
  const signUpBody = await signUpResponse.json();
  assert.equal(
    signUpResponse.status,
    200,
    `Auth Emulator sign-up failed: ${JSON.stringify(signUpBody)}`
  );

  const adminApp = initializeApp(
    {projectId},
    `legacy-profile-contract-${randomUUID()}`
  );
  const database = getFirestore(adminApp);
  const userRef = database.collection("users").doc(signUpBody.localId);
  const publicProfileRef = database.collection("publicProfiles").doc(signUpBody.localId);

  try {
    await userRef.set({
      uid: signUpBody.localId,
      name: "Legacy Display Name",
      profilePictureUrl: "https://cdn.example.test/legacy-avatar.png",
      bio: "Legacy public biography",
      email,
      phoneNumber: "+254700000001",
      userType: "PROPERTY_OWNER",
      verificationLevel: "NONE",
      followerCount: 12,
    });
    await publicProfileRef.set({
      uid: signUpBody.localId,
      profileType: "PROPERTY_OWNER",
      email: "stale-public-email@example.test",
      phoneNumber: "+254700000099",
      userType: "ADMIN",
      verificationLevel: "TRUSTED_PARTNER",
      followerCount: 999,
      stalePrivateField: "must be removed",
    });

    const migrated = await callSyncUserProfile({}, signUpBody.idToken);
    assert.equal(
      migrated.response.status,
      200,
      `Legacy profile sync failed: ${JSON.stringify(migrated.body)}`
    );

    const [privateSnapshot, publicSnapshot] = await Promise.all([
      userRef.get(),
      publicProfileRef.get(),
    ]);
    const privateProfile = privateSnapshot.data();
    const publicProfile = publicSnapshot.data();

    assert.equal(publicProfile.displayName, "Legacy Display Name");
    assert.equal(
      publicProfile.profilePictureUrl,
      "https://cdn.example.test/legacy-avatar.png"
    );
    assert.equal(publicProfile.bio, "Legacy public biography");
    assert.equal(publicProfile.profileCategory, "PROPERTY_OWNER");
    assert.equal("profileType" in publicProfile, false);
    assert.equal("email" in publicProfile, false);
    assert.equal("phoneNumber" in publicProfile, false);
    assert.equal("userType" in publicProfile, false);
    assert.equal("verificationLevel" in publicProfile, false);
    assert.equal("followerCount" in publicProfile, false);
    assert.equal("stalePrivateField" in publicProfile, false);
    assert.equal(privateProfile.email, email);
    assert.equal(privateProfile.phoneNumber, "+254700000001");
    assert.equal(privateProfile.userType, "PROPERTY_OWNER");
    assert.equal(privateProfile.followerCount, 12);
  } finally {
    await Promise.all([userRef.delete(), publicProfileRef.delete()]);
    try {
      await fetch(
        `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:delete?key=${authApiKey}`,
        {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({idToken: signUpBody.idToken}),
        }
      );
    } finally {
      await deleteApp(adminApp);
    }
  }
});
