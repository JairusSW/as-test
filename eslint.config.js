// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import aseslint from "./tools/assemblyscript-eslint-local.js";

export default tseslint.config(
  {
    ignores: [
      "assembly/**",
      "bin/**",
      "templates/**",
      "tests/**/*.js",
      "transform/lib/**",
      "build/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        WebAssembly: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["transform/src/coverage.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
    },
  },
  {
    files: ["transform/src/visitor.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  aseslint.config,
);
