import { defineConfig } from "vitest/config";

// Full-stack hosting smoke test. Unlike the handler-level integration tests
// (which mount handlers from source behind their own server), this hits the
// HOSTING emulator over real HTTP, so it exercises the firebase.json rewrites
// AND the tsup-built functions bundle running in plain Node. Run via
// `pnpm test:smoke`, which builds the bundle and starts the full emulator stack
// (auth, firestore, functions, hosting) with `firebase emulators:exec`.
export default defineConfig({
  test: {
    include: ["smoke/**/*.smoke.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
