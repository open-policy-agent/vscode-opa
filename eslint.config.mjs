import pluginJs from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "out/",
    ],
  },
  {
    files: ["**/*.{js,mjs,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    ...pluginJs.configs.recommended,
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "@stylistic": stylistic,
    },
    rules: {
      ...tseslint.configs.eslintRecommended.rules,
      ...tseslint.configs.strict.rules,

      // Keep useful stylistic rules that don't conflict with Prettier
      "@stylistic/no-trailing-spaces": "error",
      "@stylistic/no-multiple-empty-lines": "error",

      // Disabled because Prettier handles these
      "@stylistic/no-extra-semi": "off",
      "@stylistic/quotes": "off",
      "@stylistic/semi": "off",
      "@stylistic/brace-style": "off",
    },
  },
);
