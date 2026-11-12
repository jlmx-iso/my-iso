import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    ".claude/**",
    "coverage/**",
    "next-env.d.ts",
  ]),

  // Next.js rules. This also registers the react, react-hooks, jsx-a11y,
  // import and @next/next plugins used below.
  ...nextCoreWebVitals,

  // Type-aware TypeScript rules for every linted file.
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // worker.ts and src/do/** are type-checked against the Workers
        // runtime types, so they live in their own project.
        project: ["./tsconfig.json", "./tsconfig.worker.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    // Same file set as eslint-config-next, which is where the import plugin
    // is registered.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports", prefer: "type-imports" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      // `||` on strings is used on purpose throughout to fall back on empty
      // strings as well as null/undefined; `??` would change behaviour.
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: { string: true } },
      ],
      "@typescript-eslint/require-await": "off",
      "import/order": [
        "error",
        {
          alphabetize: { caseInsensitive: true, order: "asc" },
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
          ],
          "newlines-between": "always",
        },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  {
    // Vitest's asymmetric matchers (expect.objectContaining, expect.any, ...)
    // are typed `any`, so nesting them in an expected object trips this rule.
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  {
    // CLI scripts: console output is their user interface.
    files: ["prisma/seed.ts", "scripts/**"],
    rules: {
      "no-console": "off",
    },
  },

  // Must stay last: turns off formatting rules that conflict with Prettier.
  prettier,
]);
