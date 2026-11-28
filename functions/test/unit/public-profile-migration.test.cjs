const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  buildAllowlistedPublicProfile,
  isCanonical,
  parseArgs,
} = require("../../scripts/migrate-public-profiles.cjs");

describe("public profile backfill policy", () => {
  it("copies only validated public display fields and removes private fields", () => {
    const profile = buildAllowlistedPublicProfile(
      "synthetic-user",
      {
        profileType: "PROPERTY_OWNER",
        email: "leaked@example.test",
        phoneNumber: "+254700000001",
        userType: "ADMIN",
        verificationLevel: "TRUSTED_PARTNER",
        followerCount: 999,
        unknownField: "must not survive",
      },
      {
        name: "  Example Owner  ",
        profilePictureUrl: "https://cdn.example.test/owner.png",
        bio: "  Public description  ",
        email: "private@example.test",
        phoneNumber: "+254700000099",
        userType: "ADMIN",
        verificationLevel: "TRUSTED_PARTNER",
        propertyCount: 100,
      }
    );

    assert.deepEqual(profile, {
      uid: "synthetic-user",
      displayName: "Example Owner",
      profilePictureUrl: "https://cdn.example.test/owner.png",
      bio: "Public description",
      profileCategory: "PROPERTY_OWNER",
    });
  });

  it("never derives a public category from the private userType role", () => {
    const profile = buildAllowlistedPublicProfile(
      "synthetic-user",
      {},
      {
        name: "Example Person",
        userType: "ADMIN",
        verificationLevel: "TRUSTED_PARTNER",
      }
    );

    assert.deepEqual(profile, {
      uid: "synthetic-user",
      displayName: "Example Person",
    });
  });

  it("prefers current public values and honours an explicit picture clear", () => {
    const profile = buildAllowlistedPublicProfile(
      "synthetic-user",
      {
        displayName: "Current Public Name",
        profilePictureUrl: null,
        profileCategory: "AGENT",
        profileType: "PROPERTY_OWNER",
      },
      {
        name: "Legacy Private Name",
        profilePictureUrl: "https://cdn.example.test/old.png",
        userType: "PROPERTY_OWNER",
      }
    );

    assert.deepEqual(profile, {
      uid: "synthetic-user",
      displayName: "Current Public Name",
      profilePictureUrl: null,
      profileCategory: "AGENT",
    });
  });

  it("rejects unsafe profile pictures and ignores invalid categories", () => {
    const profile = buildAllowlistedPublicProfile(
      "synthetic-user",
      {
        profilePictureUrl: "http://cdn.example.test/avatar.png",
        profileCategory: "ADMIN",
        profileType: "SUPERUSER",
      },
      {
        profilePictureUrl: "javascript:alert(1)",
        name: "Valid Name",
        userType: "PROPERTY_OWNER",
      }
    );

    assert.deepEqual(profile, {
      uid: "synthetic-user",
      displayName: "Valid Name",
    });
  });

  it("detects unexpected fields and non-canonical public values", () => {
    const candidate = {
      uid: "synthetic-user",
      displayName: "Example",
    };

    assert.equal(
      isCanonical({
        uid: "synthetic-user",
        displayName: "Example",
        email: "must-remove@example.test",
        createdAt: "existing-create-time",
      }, candidate),
      false
    );

    assert.equal(
      isCanonical({
        uid: "synthetic-user",
        displayName: "Example",
        createdAt: "existing-create-time",
        updatedAt: "existing-update-time",
      }, candidate),
      true
    );
  });

  it("defaults to dry-run and requires an explicit project ID", () => {
    assert.throws(
      () => parseArgs([]),
      /Specify --project/
    );

    assert.deepEqual(
      parseArgs(["--project", "demo-estatia-ci", "--limit=10"]),
      {
        projectId: "demo-estatia-ci",
        apply: false,
        limit: 10,
        batchSize: 400,
      }
    );

    assert.equal(
      parseArgs(["--project=demo-estatia-ci", "--apply"]).apply,
      true
    );
  });
});
