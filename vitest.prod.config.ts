import { defineConfig } from "vitest/config";

// Production smoke test. Hits the LIVE deployment over HTTPS (default
// https://paper-baker.web.app, override with PAPERBAKER_PROD_URL) — no emulator,
// no build. This is the only layer that exercises the real deployed bundle, the
// actual Firebase Hosting rewrites, and Cloud Run's invoker/IAM. Run via
// `pnpm test:prod`; also runs automatically as the last step of `pnpm deploy:prod`.
// Timeouts are generous because the first hit can pay a Cloud Run cold start.
export default defineConfig({
  test: {
    include: ["smoke/prod.smoke.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
