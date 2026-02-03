import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import promisePlugin from "eslint-plugin-promise";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  { ignores: ["dist/**", ".adminjs/**"] },
  js.configs.recommended,

  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      import: importPlugin,
      promise: promisePlugin,
    },
    rules: {
      "no-console": "warn",
      "no-unused-vars": "warn",
      "import/order": "off",
      "promise/catch-or-return": "warn",
    },
  },

  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },

  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },

  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    },
  },
];
