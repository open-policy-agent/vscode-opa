import pluginJs from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/",
      "out/",
    ],
  },
  {
    files: ["**/*.{js,mjs,jsx}"],
    settings: {},
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    languageOptions: {
      globals: globals.browser,
    },
  },
  pluginJs.configs.recommended,
  {
    rules: {},
  },
];
