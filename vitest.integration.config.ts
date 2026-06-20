import { defineConfig } from "vitest/config";

// End-to-end / integration tests that hit the network (arxiv) and build the
// CLI. Kept separate from the fast hermetic `pnpm test` suite. Run with
// `pnpm test:integration`.
export default defineConfig({
  test: {
    include: [
      "apps/**/*.integration.test.ts",
      "packages/**/*.integration.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 90_000,
    hookTimeout: 130_000,
    // Network-bound; run serially for clear output.
    fileParallelism: false,
  },
});
