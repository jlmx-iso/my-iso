import { readFileSync } from "fs";
import path from "path";

import { configDefaults, defineConfig } from "vitest/config";

import { COVERAGE_INCLUDE, coverageExclude } from "./coverage.config.mjs";

// Kept in a JSON file so scripts/coverage-ratchet.mjs can raise the numbers
// when coverage rises. Never lower them by hand (docs/TESTING.md); CI's
// coverage guard fails a pull request that does without the
// `coverage-exception` label.
const coverageThresholds = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "coverage-thresholds.json"), "utf8"),
) as Record<string, unknown>;

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    coverage: {
      // What is measured and what is left out, each exclusion with its
      // reason, lives in coverage.config.mjs (shared with the diff-coverage
      // and guard scripts). The bar is documented in docs/TESTING.md.
      include: COVERAGE_INCLUDE,
      exclude: coverageExclude(import.meta.dirname),
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      thresholds: coverageThresholds,
    },
    env: {
      NODE_ENV: "test",
      SKIP_ENV_VALIDATION: "1",
    },
    // Node by default. DOM tests opt in per file with a
    // `// @vitest-environment happy-dom` docblock (see docs/TESTING.md).
    environment: "node",
    // .claude/ can hold agent worktrees with their own copy of the suite.
    exclude: [...configDefaults.exclude, ".claude/**", ".stryker-tmp/**", "e2e/**"],
    globals: true,
    setupFiles: ["./src/test/setup.ts", "./src/test/dom/setup.ts"],
  },
});
