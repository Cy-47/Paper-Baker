import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Inject the package version at build time so `pb --version` and `pb update`
// share one source of truth (package.json) and can't drift. src/version.ts
// reads this define, falling back to a dev sentinel when it's absent (tsx/tests).
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  define: { __PB_VERSION__: JSON.stringify(version) },
  // ESM (dist/index.js) is what npm/npx consumes.
  // CJS (dist/index.cjs) is what pkg compiles into the standalone binary —
  // pkg's snapshot/bytecode path is most reliable with CommonJS.
  format: ["esm", "cjs"],
  target: "node20",
  // Bundle the workspace packages and commander into a single file so the
  // published package is fully self-contained (zero runtime dependencies).
  noExternal: [/@paper-baker\/.*/, "commander"],
  clean: true,
  minify: false,
});
