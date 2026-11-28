# Dependency Overrides

## Firebase Realtime Database standalone bundle

The Functions dependency graph includes `firebase-admin`, which loads
`@firebase/database-compat/standalone` while initializing its Realtime
Database integration.

The lockfile previously resolved `@firebase/database-compat@2.1.5`.
That release introduced a regression: its standalone bundle externalized
`@firebase/app` without declaring it as a runtime dependency. This caused
`MODULE_NOT_FOUND: @firebase/app` when the Firebase Functions Emulator
loaded the function runtime.

Upstream issue: [firebase/firebase-js-sdk#10242](https://github.com/firebase/firebase-js-sdk/issues/10242).

Upstream fix: [firebase/firebase-js-sdk#10243](https://github.com/firebase/firebase-js-sdk/pull/10243),
released in `@firebase/database-compat@2.1.6`.

The root Functions package therefore pins the transitive dependency to
`2.1.6` using npm `overrides`. The lockfile records the matching exact
package version, registry URL, and integrity hash. This avoids adding the
browser Firebase App SDK to a server-side Functions runtime merely to work
around an upstream standalone-bundle regression.

The runtime regression test
(`functions/test/runtime/firebase-admin-database.test.cjs`) imports the
same Firebase Admin Database entrypoint that triggers the failing load.
It runs as part of `npm test`, before the emulator integration test.

## Removal criteria

Do not remove the override solely because a newer transitive version exists.
First verify the selected standalone bundle no longer imports undeclared
client SDK modules, remove the override on a dedicated dependency update,
regenerate the lockfile with the pinned Node/npm toolchain, and keep the
runtime regression test passing on a clean `npm ci` install.
