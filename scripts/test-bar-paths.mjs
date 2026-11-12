#!/usr/bin/env node
// The files that make up the test bar, and the check the test-bar guard
// workflow (.github/workflows/test-bar-guard.yml) runs on every pull
// request: a pull request that changes any of them needs the
// `coverage-exception` label. The workflow runs on pull_request_target, so
// it is always the base branch's copy of this file and of the workflow that
// runs, never the pull request's: a pull request cannot weaken either.
// It never runs code from the pull request; it only reads the list of
// changed file names and, for coverage-thresholds.json and package.json,
// the two JSON texts.
//
// package.json is protected field by field: a change that only bumps
// dependency versions (registry version ranges, nothing else) needs no
// label; any other change to it (its `scripts` above all) does. See
// packageJsonOnlyDependencies.
//
//   node scripts/test-bar-paths.mjs --files changed.txt \
//     [--thresholds-base base.json --thresholds-head head.json] \
//     [--package-base base.json --package-head head.json]
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
  "src/test/dom/render.tsx",
  "src/test/setup.ts",
  "src/test/helpers/dbCaller.ts",
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
 * The package.json fields a pull request may change without the label:
 * the dependency lists and the Node/npm versions. Every other field (and a
 * field added or removed) can change what the test commands run: `scripts`
 * most obviously, but also `imports` (it can redirect a module) or `type`.
 */
export const PACKAGE_JSON_DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "engines",
]);

/**
 * A version range from the npm registry: "^1.2.3", "~4", ">=22",
 * "5.0.0-beta.32", "1.2.3 || ^2". Never an alias ("npm:other@1"), a URL,
 * a git or GitHub reference ("user/repo"), a path ("file:..") or a tag:
 * those can put any code in place of a test tool.
 */
const REGISTRY_RANGE = /^(?:[~^]|[<>]=?|=)?\d[0-9A-Za-z.+-]*(?:\s*(?:\|\||\s-\s|\s)\s*(?:[~^]|[<>]=?|=)?\d[0-9A-Za-z.+-]*)*$/;

/** `overrides` may also point at the root's own range ("$name"). */
const OVERRIDE_REFERENCE = /^\$[@a-z0-9][\w./@-]*$/i;

/**
 * Whether every version in a dependency field (nested, for `overrides`) is
 * a registry range.
 *
 * @param {unknown} value
 * @param {boolean} isOverride
 * @returns {boolean}
 */
function onlyRegistryRanges(value, isOverride) {
  if (typeof value === "string") {
    const text = value.trim();
    return REGISTRY_RANGE.test(text) || (isOverride && OVERRIDE_REFERENCE.test(text));
  }
  if (!isObject(value)) return false;
  if (!isOverride) return Object.values(value).every((range) => typeof range === "string" && onlyRegistryRanges(range, false));
  // overrides: { "pkg": "range" } or { "pkg": { ".": "range", "dep": "range" } }
  return Object.values(value).every((range) => onlyRegistryRanges(range, true));
}

/**
 * Whether a package.json change only touches dependency versions, so the
 * pull request needs no label: every field outside
 * PACKAGE_JSON_DEPENDENCY_FIELDS is identical (same keys, same values,
 * `scripts` included), each changed dependency field holds registry version
 * ranges only, and `engines` names only node and npm. Invalid JSON on
 * either side counts as not only dependencies.
 *
 * @param {string} baseText
 * @param {string} headText
 */
export function packageJsonOnlyDependencies(baseText, headText) {
  try {
    const base = /** @type {unknown} */ (JSON.parse(baseText));
    const head = /** @type {unknown} */ (JSON.parse(headText));
    if (!isObject(base) || !isObject(head)) return false;
    const keys = new Set([...Object.keys(base), ...Object.keys(head)]);
    for (const key of keys) {
      const same = JSON.stringify(base[key]) === JSON.stringify(head[key]);
      if (same) continue;
      if (!PACKAGE_JSON_DEPENDENCY_FIELDS.includes(key) || !(key in head)) return false;
      const value = head[key];
      if (key === "engines") {
        if (!isObject(value)) return false;
        const names = Object.keys(value);
        if (!names.every((name) => name === "node" || name === "npm")) return false;
        if (!onlyRegistryRanges(value, false)) return false;
        continue;
      }
      if (!onlyRegistryRanges(value, key === "overrides")) return false;
    }
    return true;
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
 * @param {{ changed: readonly string[], exception: boolean, thresholdsRaisedOnly: boolean, packageDependenciesOnly?: boolean }} input
 */
export function evaluate({ changed, exception, thresholdsRaisedOnly, packageDependenciesOnly = false }) {
  const matches = protectedChanges(changed).filter(
    (file) =>
      !(file === "coverage-thresholds.json" && thresholdsRaisedOnly) &&
      !(file === "package.json" && packageDependenciesOnly),
  );
  const lines = ["### Test bar guard", ""];
  if (thresholdsRaisedOnly && changed.includes("coverage-thresholds.json")) {
    lines.push("coverage-thresholds.json changed, and only upward: allowed without the label.", "");
  }
  if (packageDependenciesOnly && changed.some((file) => file.trim() === "package.json")) {
    lines.push("package.json changed, in dependency versions only (no scripts or other fields): allowed without the label.", "");
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
      "package-base": { type: "string" },
      "package-head": { type: "string" },
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

  const packageBase = values["package-base"];
  const packageHead = values["package-head"];
  const packageDependenciesOnly =
    !!packageBase &&
    !!packageHead &&
    packageJsonOnlyDependencies(readFileSync(packageBase, "utf8"), readFileSync(packageHead, "utf8"));

  const result = evaluate({
    changed,
    exception: process.env.HAS_EXCEPTION === "true",
    packageDependenciesOnly,
    thresholdsRaisedOnly,
  });
  console.log(result.summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.summary}\n`);
  if (!result.pass) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
