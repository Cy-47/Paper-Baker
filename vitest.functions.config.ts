import { defineConfig } from "vitest/config";

// High-level integration tests for the Cloud Functions route handlers, driven
// directly against the Firestore emulator (auth is mocked). Run via
// `pnpm test:functions`, which starts the emulator with `firebase emulators:exec`
// before invoking this config.
export default defineConfig({
  test: {
    include: ["functions/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 15000,
    hookTimeout: 30000,
    // These files share one Firestore emulator and each wipes it in beforeEach,
    // so they must not run in parallel or they'd clobber each other's data.
    fileParallelism: false,
  },
});
