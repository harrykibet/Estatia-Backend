#!/usr/bin/env node
"use strict";

const VALID_CATEGORIES = new Set([
  "TENANT",
  "AGENT",
  "PROPERTY_OWNER",
]);
const ALLOWED_PUBLIC_FIELDS = new Set([
  "uid",
  "displayName",
  "profilePictureUrl",
  "bio",
  "profileCategory",
  "createdAt",
  "updatedAt",
]);

function boundedString(value, maxLength) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    return undefined;
  }
  return normalized;
}

function safeHttpsUrl(value) {
  if (value === null) {
    return null;
  }
  const normalized = boundedString(value, 2048);
  if (!normalized) {
    return undefined;
  }
  try {
    const url = new URL(normalized);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return undefined;
    }
    return normalized;
  } catch {
    return undefined;
  }
}

function safeCategory(value) {
  return typeof value === "string" && VALID_CATEGORIES.has(value) ?
    value : undefined;
}

/**
 * Builds a strict public-profile document.
 *
 * Existing public display values win. Missing display values may be recovered
 * from the legacy private document after validation. Private contact data,
 * roles, verification state, counters, favourites and unknown fields are never
 * copied. In particular, private userType is not a source for profileCategory.
 *
 * @param {string} uid Firestore document ID.
 * @param {Record<string, unknown>} publicProfile Existing public document.
 * @param {Record<string, unknown>} privateUser Legacy private user document.
 * @return {Record<string, unknown>} Canonical public display document.
 */
function buildAllowlistedPublicProfile(
  uid,
  publicProfile = {},
  privateUser = {}
) {
  if (typeof uid !== "string" || uid.trim().length === 0) {
    throw new TypeError("A non-empty profile UID is required.");
  }

  const result = {uid};

  const displayName =
    boundedString(publicProfile.displayName, 80) ??
    boundedString(privateUser.name, 80);
  if (displayName) {
    result.displayName = displayName;
  }

  const pictureIsExplicitlyCleared =
    Object.prototype.hasOwnProperty.call(publicProfile, "profilePictureUrl") &&
    publicProfile.profilePictureUrl === null;
  const picture = pictureIsExplicitlyCleared ? null :
    safeHttpsUrl(publicProfile.profilePictureUrl) ??
    safeHttpsUrl(privateUser.profilePictureUrl);
  if (picture !== undefined) {
    result.profilePictureUrl = picture;
  }

  const publicBio = boundedString(publicProfile.bio, 500);
  const privateBio = boundedString(privateUser.bio, 500);
  const bio = publicBio ?? privateBio;
  if (bio !== undefined) {
    result.bio = bio;
  }

  const category =
    safeCategory(publicProfile.profileCategory) ??
    safeCategory(publicProfile.profileType);
  if (category) {
    result.profileCategory = category;
  }

  return result;
}

function isCanonical(publicProfile, candidate) {
  const currentKeys = Object.keys(publicProfile)
    .filter((key) => key !== "createdAt" && key !== "updatedAt")
    .sort();
  const candidateKeys = Object.keys(candidate).sort();
  if (
    currentKeys.length !== candidateKeys.length ||
    currentKeys.some((key, index) => key !== candidateKeys[index])
  ) {
    return false;
  }

  return candidateKeys.every((key) =>
    publicProfile[key] === candidate[key]
  );
}

function parseArgs(argv) {
  const options = {
    projectId: process.env.GCLOUD_PROJECT || "",
    apply: false,
    limit: 0,
    batchSize: 400,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--project") {
      options.projectId = argv[++index] || "";
    } else if (arg.startsWith("--project=")) {
      options.projectId = arg.slice("--project=".length);
    } else if (arg === "--limit") {
      options.limit = Number(argv[++index]);
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number(arg.slice("--limit=".length));
    } else if (arg === "--batch-size") {
      options.batchSize = Number(argv[++index]);
    } else if (arg.startsWith("--batch-size=")) {
      options.batchSize = Number(arg.slice("--batch-size=".length));
    } else if (arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.help) {
    return options;
  }
  if (!options.projectId.trim()) {
    throw new Error(
      "Specify --project <project-id> or set GCLOUD_PROJECT explicitly."
    );
  }
  if (!Number.isInteger(options.limit) || options.limit < 0) {
    throw new Error("--limit must be a non-negative integer.");
  }
  if (
    !Number.isInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 450
  ) {
    throw new Error("--batch-size must be an integer between 1 and 450.");
  }
  return options;
}

async function migratePublicProfiles({
  database,
  FieldValue,
  FieldPath,
  dryRun = true,
  limit = 0,
  batchSize = 400,
  log = () => {},
}) {
  let cursor;
  let scanned = 0;
  let sanitized = 0;
  let committed = 0;

  while (true) {
    const remaining = limit > 0 ? limit - scanned : batchSize;
    if (limit > 0 && remaining <= 0) {
      break;
    }

    const pageSize = Math.min(batchSize, remaining);
    let query = database
      .collection("publicProfiles")
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) {
      query = query.startAfter(cursor);
    }

    const page = await query.get();
    if (page.empty) {
      break;
    }
    cursor = page.docs[page.docs.length - 1];
    scanned += page.docs.length;

    const privateSnapshots = await Promise.all(
      page.docs.map((document) =>
        database.collection("users").doc(document.id).get()
      )
    );

    const batch = database.batch();
    let pageSanitized = 0;

    page.docs.forEach((document, index) => {
      const existing = document.data() || {};
      const privateUser = privateSnapshots[index].data() || {};
      const canonical = buildAllowlistedPublicProfile(
        document.id,
        existing,
        privateUser
      );

      if (isCanonical(existing, canonical)) {
        return;
      }

      pageSanitized += 1;
      if (!dryRun) {
        batch.set(document.ref, {
          ...canonical,
          createdAt: existing.createdAt ?? FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    sanitized += pageSanitized;
    if (!dryRun && pageSanitized > 0) {
      await batch.commit();
      committed += pageSanitized;
    }

    log({
      scanned,
      sanitized,
      committed,
      dryRun,
    });

    if (page.docs.length < pageSize) {
      break;
    }
  }

  return {scanned, sanitized, committed, dryRun};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: npm --prefix functions run migrate:public-profiles -- " +
      "--project <project-id> [--apply] [--limit N] [--batch-size N]\n" +
      "Defaults to a read-only dry run. --apply is required to write.\n"
    );
    return;
  }

  const {applicationDefault, getApps, initializeApp} =
    require("firebase-admin/app");
  const {FieldPath, FieldValue, getFirestore} =
    require("firebase-admin/firestore");

  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId: options.projectId,
    });
  }

  const database = getFirestore();
  const dryRun = !options.apply;
  process.stdout.write(
    `Project: ${options.projectId}\nMode: ${dryRun ? "DRY RUN (read-only)" : "APPLY"}\n`
  );
  if (dryRun) {
    process.stdout.write("No documents will be written.\n");
  }

  const summary = await migratePublicProfiles({
    database,
    FieldValue,
    FieldPath,
    dryRun,
    limit: options.limit,
    batchSize: options.batchSize,
    log: (state) => process.stdout.write(
      `Scanned ${state.scanned}; requiring sanitation ${state.sanitized}; committed ${state.committed}.\n`
    ),
  });

  process.stdout.write(
    `Complete. Scanned ${summary.scanned}; requiring sanitation ${summary.sanitized}; committed ${summary.committed}.\n`
  );
  if (dryRun && summary.sanitized > 0) {
    process.stdout.write(
      "Review the target project and rerun with --apply only after approval.\n"
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Public profile migration failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildAllowlistedPublicProfile,
  isCanonical,
  migratePublicProfiles,
  parseArgs,
};
