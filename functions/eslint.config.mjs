import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import { importX } from "eslint-plugin-import-x";
import globals from "globals";
import tseslint from "typescript-eslint";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  globalIgnores([
    "lib/**",
    "generated/**",
  ]),
  {
    files: ["**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}"],
    extends: [
      js.configs.recommended,
      ...compat.extends("google"),
      importX.flatConfigs.recommended,
      importX.flatConfigs.typescript,
    ],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "quotes": ["error", "double"],
      "import-x/no-unresolved": "off",
      "indent": ["error", 2],
    },
  },
  {
    files: ["**/*.{ts,cts,mts,tsx}"],
    extends: [
      tseslint.configs.recommended,
    ],
    rules: {
      "import-x/named": "off",
    },
  },
]);
