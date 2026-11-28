const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { deleteApp, initializeApp } = require("firebase-admin/app");
const {
  FieldPath,
  FieldValue,
  getFirestore,
} = require("firebase-admin/firestore");
const {
  migratePublicProfiles,
} = require("../../scripts/migrate-public-profiles.cjs");

const projectId = process.env.GCLOUD_PROJECT ?? "demo-estatia-ci";

test("public profile backfill is dry-run by default and strips stale fields on apply", async () => {
  const adminApp = initializeApp(
    {projectId},
    `public-profile-migration-${randomUUID()}`
  );
  const database = getFirestore(adminApp);
  const propertyOwnerUid = `migration-owner-${randomUUID()}`;
  const adminUid = `migration-admin-${randomUUID()}`;
  const ownerPublicRef = database.collection("publicProfiles").doc(propertyOwnerUid);
  const adminPublicRef = database.collection("publicProfiles").doc(adminUid);
  const ownerPrivateRef = database.collection("users").doc(propertyOwnerUid);
  const adminPrivateRef = database.collection("users").doc(adminUid);

  try {
    await Promise.all([
      ownerPrivateRef.set({
        uid: propertyOwnerUid,
        name: "Legacy Owner Name",
        email: "owner-private@example.test",
        phoneNumber: "+254700000001",
        userType: "PROPERTY_OWNER",
        verificationLevel: "NONE",
      }),
      adminPrivateRef.set({
        uid: adminUid,
        name: "Legacy Admin Name",
        email: "admin-private@example.test",
        userType: "ADMIN",
        verificationLevel: "TRUSTED_PARTNER",
      }),
      ownerPublicRef.set({
        uid: propertyOwnerUid,
        profileType: "PROPERTY_OWNER",
        email: "stale-owner@example.test",
        phoneNumber: "+254700000099",
        userType: "ADMIN",
        verificationLevel: "TRUSTED_PARTNER",
        followerCount: 900,
        stalePrivateField: "remove",
      }),
      adminPublicRef.set({
        uid: adminUid,
        email: "stale-admin@example.test",
        userType: "ADMIN",
        verificationLevel: "TRUSTED_PARTNER",
        stalePrivateField: "remove",
      }),
    ]);

    const dryRun = await migratePublicProfiles({
      database,
      FieldValue,
      FieldPath,
      dryRun: true,
      batchSize: 1,
      limit: 10,
    });

    assert.deepEqual(dryRun, {
      scanned: 2,
      sanitized: 2,
      committed: 0,
      dryRun: true,
    });
    assert.equal(
      (await ownerPublicRef.get()).get("email"),
      "stale-owner@example.test",
      "Dry-run must not modify stored documents."
    );

    const applied = await migratePublicProfiles({
      database,
      FieldValue,
      FieldPath,
      dryRun: false,
      batchSize: 1,
      limit: 10,
    });

    assert.deepEqual(applied, {
      scanned: 2,
      sanitized: 2,
      committed: 2,
      dryRun: false,
    });

    const [ownerPublic, adminPublic] = await Promise.all([
      ownerPublicRef.get(),
      adminPublicRef.get(),
    ]);
    const ownerData = ownerPublic.data();
    const adminData = adminPublic.data();

    assert.equal(ownerData.uid, propertyOwnerUid);
    assert.equal(ownerData.profileCategory, "PROPERTY_OWNER");
    assert.equal(ownerData.displayName, "Legacy Owner Name");
    assert.equal("profileType" in ownerData, false);
    assert.equal("email" in ownerData, false);
    assert.equal("phoneNumber" in ownerData, false);
    assert.equal("userType" in ownerData, false);
    assert.equal("verificationLevel" in ownerData, false);
    assert.equal("followerCount" in ownerData, false);
    assert.equal("stalePrivateField" in ownerData, false);

    assert.equal(adminData.uid, adminUid);
    assert.equal(adminData.displayName, "Legacy Admin Name");
    assert.equal("profileCategory" in adminData, false);
    assert.equal("email" in adminData, false);
    assert.equal("userType" in adminData, false);
    assert.equal("verificationLevel" in adminData, false);
    assert.equal("stalePrivateField" in adminData, false);

    // The private records and their server-owned roles are not modified.
    assert.equal((await ownerPrivateRef.get()).get("userType"), "PROPERTY_OWNER");
    assert.equal((await adminPrivateRef.get()).get("userType"), "ADMIN");
  } finally {
    await Promise.all([
      ownerPublicRef.delete(),
      adminPublicRef.delete(),
      ownerPrivateRef.delete(),
      adminPrivateRef.delete(),
    ]);
    await deleteApp(adminApp);
  }
});
