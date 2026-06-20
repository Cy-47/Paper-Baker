import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

// The Cloud Functions emulator (and a real deploy) run the built dist with plain
// Node, which can't import the source-only @paper-baker/core workspace package.
// So bundle it INTO dist/index.js, while keeping firebase-admin / firebase-
// functions external as normal node_modules (the emulator's function discovery
// reflects over the real firebase-functions).
//
// core is resolved by FILE PATH via an esbuild alias rather than as a package
// dependency. That keeps functions/package.json free of any `workspace:*` dep —
// Google's Cloud Functions buildpack runs a plain `npm install` (devDeps and
// all), which can't parse the pnpm `workspace:` protocol and fails the deploy.
const corePath = fileURLToPath(
  new URL("../packages/core/src/index.ts", import.meta.url),
);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  minify: false,
  esbuildOptions(options) {
    options.alias = { ...options.alias, "@paper-baker/core": corePath };
  },
});
