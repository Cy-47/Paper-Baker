import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/", "**/node_modules/", "**/binaries/", "**/.firebase/"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node-side code: scripts, config, CLI, functions.
    files: ["**/*.{js,mjs,cjs}", "apps/cli/**", "functions/**", "packages/**"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Browser-side code.
    files: ["apps/web/**"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // Root config files + Playwright E2E: run under Node, but E2E
    // page.evaluate callbacks reference browser globals.
    files: ["*.config.ts", "e2e/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  }
);
