// Single source of truth for the CLI version. tsup injects the real value from
// package.json at build time via a `define` (see tsup.config.ts), so the binary
// and `pb --version` can never drift from the published package. Under tsx/tests
// the define isn't applied; `typeof` on the undeclared identifier is safe (it
// yields "undefined" instead of throwing) and we fall back to a dev sentinel.
declare const __PB_VERSION__: string | undefined;

export const VERSION: string =
  typeof __PB_VERSION__ === "string" ? __PB_VERSION__ : "0.0.0-dev";
