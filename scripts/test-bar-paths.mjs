#!/usr/bin/env node
// The files that make up the test bar, and the check the test-bar guard
// workflow (.github/workflows/test-bar-guard.yml) runs on every pull
// request: a pull request that changes any of them needs the
// `coverage-exception` label. The workflow runs on pull_request_target, so
// it is always the base branch's copy of this file and of the workflow that
// runs, never the pull request's: a pull request cannot weaken either.
// It never runs code from the pull request; it only reads the list of
// changed file names and, for coverage-thresholds.json, the two JSON texts.
//
//   node scripts/test-bar-paths.mjs --files changed.txt \
//     [--thresholds-base base.json --thresholds-head head.json]
//   (HAS_EXCEPTION=true when the pull request has the label)
//
// Keep PROTECTED_PATHS in step with .github/CODEOWNERS.

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { compareThresholds } from "./coverage-guard.mjs";

export const EXCEPTION_LABEL = "coverage-exception";

export const PROTECTED_PATHS = [
  "coverage-thresholds.json",
  "coverage.config.mjs",
  "vitest.config.ts",
  "package.json",
  "stryker.config.mjs",
  "scripts/coverage-*.mjs",
  "scripts/diff-coverage.mjs",
  "scripts/test-bar-paths.mjs",
  "src/test/dom/strict.ts",
  "src/test/dom/setup.ts",
  "src/server/api/authz.matrix.test.ts",
  "src/server/api/trpc.ts",
  ".github/workflows/**",
  ".github/CODEOWNERS",
];

/**
 * Whether a repo-relative path is part of the test bar.
 *
 * @param {string} file
 */
export function isProtectedPath(file) {
  return PROTECTED_PATHS.some((glob) => file === glob || path.matchesGlob(file, glob));
}

/**
 * The changed paths that are part of the test bar, sorted, once each.
 *
 * @param {readonly string[]} files
 */
export function protectedChanges(files) {
  return [...new Set(files.map((file) => file.trim()).filter(Boolean).filter(isProtectedPath))].sort();
}

/**
 * Whether the thresholds only rose (or stayed): then the change needs no
 * label. Invalid JSON on either side counts as not only raised.
 *
 * @param {string} baseText
 * @param {string} headText
 */
export function thresholdsOnlyRaised(baseText, headText) {
  try {
    const base = /** @type {unknown} */ (JSON.parse(baseText));
    const head = /** @type {unknown} */ (JSON.parse(headText));
    if (!isObject(base) || !isObject(head)) return false;
    return compareThresholds(base, head).length === 0;
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The check's outcome and the text for the log and the job summary.
 *
 * @param {{ changed: readonly string[], exception: boolean, thresholdsRaisedOnly: boolean }} input
 */
export function evaluate({ changed, exception, thresholdsRaisedOnly }) {
  const matches = protectedChanges(changed).filter(
    (file) => !(file === "coverage-thresholds.json" && thresholdsRaisedOnly),
  );
  const lines = ["### Test bar guard", ""];
  if (thresholdsRaisedOnly && changed.includes("coverage-thresholds.json")) {
    lines.push("coverage-thresholds.json changed, and only upward: allowed without the label.", "");
  }
  if (matches.length === 0) {
    lines.push("No test-bar file changed.");
    return { pass: true, summary: lines.join("\n") };
  }
  lines.push("This pull request changes files that make up the test bar:", "");
  for (const file of matches) lines.push(`- \`${file}\``);
  lines.push("");
  if (exception) {
    lines.push(`Allowed: the pull request has the \`${EXCEPTION_LABEL}\` label. Say why in its description.`);
    return { pass: true, summary: lines.join("\n") };
  }
  lines.push(
    `**Needs the \`${EXCEPTION_LABEL}\` label.** Changing these is a decision about the test bar: ` +
      "add the label (the check re-runs) and say why in the description (docs/TESTING.md).",
  );
  return { pass: false, summary: lines.join("\n") };
}

function main() {
  const { values } = parseArgs({
    options: {
      files: { type: "string" },
      "thresholds-base": { type: "string" },
      "thresholds-head": { type: "string" },
    },
  });
  if (!values.files) {
    console.error("--files <list of changed paths, one per line> is required");
    process.exit(2);
  }
  const changed = readFileSync(values.files, "utf8").split("\n");
  const base = values["thresholds-base"];
  const head = values["thresholds-head"];
  const thresholdsRaisedOnly =
    !!base && !!head && thresholdsOnlyRaised(readFileSync(base, "utf8"), readFileSync(head, "utf8"));

  const result = evaluate({ changed, exception: process.env.HAS_EXCEPTION === "true", thresholdsRaisedOnly });
  console.log(result.summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.summary}\n`);
  if (!result.pass) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
