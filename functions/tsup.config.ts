import { defineConfig } from "tsup";

// The Cloud Functions emulator (and a real deploy) run the built dist with plain
// Node — which cannot import the source-only @paper-baker/* workspace packages.
// So bundle those INTO dist/index.js (like the CLI does), while keeping
// firebase-admin / firebase-functions external as normal node_modules (the
// emulator's function discovery reflects over the real firebase-functions).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  noExternal: [/@paper-baker\/.*/],
  clean: true,
  minify: false,
});
