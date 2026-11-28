const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  buildProfileMutation,
  ProfileValidationError,
} = require("../../lib/auth/profilePolicy");

describe("user profile data boundary", () => {
  it("separates public display attributes from Auth-derived private attributes", () => {
    const mutation = buildProfileMutation(
      "synthetic-user",
      {
        displayName: "  Example Person  ",
        profilePictureUrl: "https://cdn.example.test/profiles/avatar.png",
        bio: "  Property enthusiast  ",
      },
      {
        email: "person@example.test",
        phone_number: "+254700000001",
        email_verified: true,
        name: "Auth Provider Name",
      }
    );

    assert.deepEqual(mutation.publicProfile, {
      uid: "synthetic-user",
      displayName: "Example Person",
      profilePictureUrl: "https://cdn.example.test/profiles/avatar.png",
      bio: "Property enthusiast",
    });
    assert.deepEqual(mutation.privateProfile, {
      uid: "synthetic-user",
      email: "person@example.test",
      phoneNumber: "+254700000001",
      emailVerified: true,
    });
  });

  it("rejects client-supplied identity, role, verification and counter fields", () => {
    for (const field of [
      "uid",
      "email",
      "phoneNumber",
      "emailVerified",
      "userType",
      "verificationLevel",
      "propertyCount",
      "followerCount",
      "followingCount",
      "role",
      "verified",
    ]) {
      assert.throws(
        () => buildProfileMutation("synthetic-user", {[field]: "attacker-value"}, {}),
        (error) => {
          assert.ok(error instanceof ProfileValidationError);
          assert.match(error.message, /Unsupported profile field/);
          return true;
        },
        `Expected ${field} to be rejected`
      );
    }
  });

  it("rejects insecure or malformed profile picture URLs", () => {
    for (const profilePictureUrl of [
      "http://cdn.example.test/avatar.png",
      "javascript:alert(1)",
      "not-a-url",
      "https://user:password@cdn.example.test/avatar.png",
    ]) {
      assert.throws(
        () => buildProfileMutation(
          "synthetic-user",
          {profilePictureUrl},
          {}
        ),
        ProfileValidationError
      );
    }
  });

  it("enforces display name and bio length limits", () => {
    assert.throws(
      () => buildProfileMutation(
        "synthetic-user",
        {displayName: "x".repeat(81)},
        {}
      ),
      ProfileValidationError
    );
    assert.throws(
      () => buildProfileMutation(
        "synthetic-user",
        {bio: "x".repeat(501)},
        {}
      ),
      ProfileValidationError
    );
  });

  it("uses Auth token claims as fallback public identity without exposing email or phone", () => {
    const mutation = buildProfileMutation(
      "synthetic-user",
      {},
      {
        name: "Verified Provider Name",
        picture: "https://images.example.test/avatar.png",
        email: "person@example.test",
        phone_number: "+254700000001",
      }
    );

    assert.deepEqual(mutation.publicProfile, {
      uid: "synthetic-user",
      displayName: "Verified Provider Name",
      profilePictureUrl: "https://images.example.test/avatar.png",
    });
    assert.equal("email" in mutation.publicProfile, false);
    assert.equal("phoneNumber" in mutation.publicProfile, false);
    assert.equal(mutation.privateProfile.email, "person@example.test");
    assert.equal(mutation.privateProfile.phoneNumber, "+254700000001");
  });
});
