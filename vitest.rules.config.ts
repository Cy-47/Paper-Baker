import { defineConfig } from "vitest/config";

// Firestore security-rules tests. Run via `pnpm test:rules`, which starts the
// Firestore emulator (firebase emulators:exec) before invoking this config.
export default defineConfig({
  test: {
    include: ["firebase/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Rules tests talk to the emulator over the network — give them room.
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
