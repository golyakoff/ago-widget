// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The widget's whole reason to exist is running on a page it does not control - a caught
      // error that only logs and degrades (embeddable-widget skill's "never break the host page")
      // legitimately has nothing left to do with its catch variable.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  // `15-11`: the type-aware block above points at `./tsconfig.json`, whose `include` is `["src"]`.
  // `ux-gate/` is a second TypeScript project with its own tsconfig, so it needs its own block -
  // otherwise every file in it is "not found in any of the provided projects" and lints as an error.
  {
    files: ["ux-gate/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./ux-gate/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // `ux-gate/server.mjs` is plain Node with no TypeScript project of its own, so type-aware linting
    // has nothing to resolve it against - same reason `build.mjs` is already here.
    ignores: [
      "dist/**",
      "demo/**",
      "build.mjs",
      "vitest.config.ts",
      "ux-gate/server.mjs",
      "ux-gate/screenshots/**",
      "ux-gate/test-results/**",
    ],
  },
);
