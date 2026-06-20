import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
