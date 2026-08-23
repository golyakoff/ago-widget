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
  {
    ignores: ["dist/**", "demo/**", "build.mjs", "vitest.config.ts"],
  },
);
