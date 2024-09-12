/** @type {import("eslint").Linter.Config} */
const config = {
  extends: [
    "plugin:import/typescript",
    "plugin:@next/next/recommended",
    "plugin:@typescript-eslint/recommended-type-checked",
    "plugin:@typescript-eslint/stylistic-type-checked",
    "prettier",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: true,
  },
  plugins: ["@typescript-eslint", "sort-keys-fix", "import"],
  rules: {
    // These opinionated rules are enabled in stylistic-type-checked above.
    // Feel free to reconfigure them to your own preference.
    "@typescript-eslint/array-type": "off",
    "@typescript-eslint/consistent-type-definitions": "off",
    "@typescript-eslint/consistent-type-imports": [
      "warn",
      {
        fixStyle: "inline-type-imports",
        prefer: "type-imports",
      },
    ],
    "@typescript-eslint/no-misused-promises": [
      "error",
      {
        checksVoidReturn: { attributes: false },
      },
    ],
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/require-await": "off",
    "import/order": [
      "error",
      {
        "alphabetize": { "caseInsensitive": true, "order": "asc" },
        "groups": ["builtin", "external", "internal", ["parent", "sibling", "index"]],
        "newlines-between": "always"
      }
    ],
    "no-console": "error",
    "sort-keys-fix/sort-keys-fix": ["error", "asc", { "caseSensitive": false, "natural": true }],
  }
};

module.exports = config;
