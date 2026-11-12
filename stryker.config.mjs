// Mutation testing (Stryker): changes small things in the code below (a `<`
// to `<=`, a condition to `true`, a string to "") and checks that some test
// fails for each change. A change no test notices ("survived") is behaviour
// the suite does not pin down.
//
//   npm run test:mutation                     # all files below
//   npm run test:mutation -- --mutate src/_lib/telemetryScrub.ts
//
// Not a CI gate: it runs weekly (.github/workflows/mutation.yml) and the
// report is read by people. See docs/TESTING.md.

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
const config = {
  // Small, pure, security- or money-relevant modules where a surviving
  // mutant is most likely a real gap.
  mutate: [
    "src/server/_billing/entitlements.ts",
    "src/server/_db/bookingTransitions.ts",
    "src/server/_utils/rateLimit.ts",
    "src/_lib/telemetryScrub.ts",
  ],
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.config.ts",
    // Run only the tests that import the mutated file.
    related: true,
  },
  coverageAnalysis: "perTest",
  checkers: [],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // Report only; never fail the run on the score.
  thresholds: { break: null, high: 80, low: 60 },
  concurrency: 4,
  timeoutMS: 30_000,
  tempDirName: ".stryker-tmp",
  ignorePatterns: [".claude", ".next", ".open-next", ".wrangler", "coverage", "reports"],
};

export default config;
