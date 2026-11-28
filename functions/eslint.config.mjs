import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import { importX } from "eslint-plugin-import-x";
import globals from "globals";
import { configs as tseslintConfigs } from "typescript-eslint";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

// eslint-config-google 0.14 predates ESLint 10. Keep its supported rules and
// omit only core rules that ESLint 10 no longer provides (for example,
// valid-jsdoc).
const googleConfigs = compat.extends("google").map((config) => {
  if (!config.rules) {
    return config;
  }

  return {
    ...config,
    rules: Object.fromEntries(
      Object.entries(config.rules).filter(([ruleName]) =>
        ruleName.includes("/") ||
        Object.hasOwn(js.configs.all.rules, ruleName),
      ),
    ),
  };
});

export default defineConfig([
  globalIgnores([
    "lib/**",
    "generated/**",
  ]),
  {
    files: ["**/*.{js,ts}"],
    extends: [
      js.configs.recommended,
      ...googleConfigs,
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
    files: ["**/*.ts"],
    extends: [
      tseslintConfigs.recommended,
    ],
    rules: {
      "import-x/named": "off",
    },
  },
]);
