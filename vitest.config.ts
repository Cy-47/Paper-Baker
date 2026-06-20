import { defineConfig } from "vitest/config";

// Unit tests for pure logic (no emulator needed). Firestore security-rules
// tests live under firebase/ and run via `pnpm test:rules` (they need the
// emulator + Java).
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    // Integration/E2E tests (network + emulator) have their own configs and
    // must not run in the fast hermetic suite.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.integration.test.ts",
    ],
  },
});
