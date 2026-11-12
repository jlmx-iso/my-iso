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
// package-lock.json likewise: a dependency bump needs no label as long as
// every package still comes from the npm registry and no measurement tool
// (MEASUREMENT_PACKAGES) changed version. See lockfileChangeIsSafe.
//
// It must run with nothing installed (the workflow does not run npm ci on
// the base checkout), so it uses Node's own modules only.
//
//   node scripts/test-bar-paths.mjs --files changed.txt \
//     [--thresholds-base base.json --thresholds-head head.json] \
//     [--package-base base.json --package-head head.json] \
//     [--lock-base base-lock.json --lock-head head-lock.json]
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
  // Checked as data like package.json: see lockfileChangeIsSafe.
  "package-lock.json",
  // Registry, scripts and install settings for npm.
  ".npmrc",
  // The Node version that runs the tests and coverage (CI reads it).
  ".nvmrc",
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
 * the dependency lists and the Node/npm versions (`engines`, and
 * `packageManager` as long as it names an exact npm release). Every other field (and a
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
  "packageManager",
]);

const NPM_RELEASE = /^npm@\d+\.\d+\.\d+$/;

/**
 * The packages that measure the test bar: the test runner, coverage, the
 * mutation tester, the browser and DOM test tools. A pull request that
 * adds, removes or changes any of them (in a dependency field, as an
 * override at any depth, or as a resolved version in package-lock.json)
 * needs the label, however it is spelled: an older vitest or v8-to-istanbul
 * can measure differently.
 */
export const MEASUREMENT_PACKAGES = Object.freeze([
  "vitest",
  "@vitest/*",
  "vite",
  "@stryker-mutator/*",
  "@playwright/test",
  "playwright*",
  "happy-dom",
  "@testing-library/*",
  "istanbul-*",
  "v8-to-istanbul",
  "ast-v8-to-istanbul",
  "@bcoe/v8-coverage",
  "test-exclude",
  "magicast",
]);

/**
 * Whether a package name is a measurement tool.
 *
 * @param {string} name
 */
export function isMeasurementPackage(name) {
  return MEASUREMENT_PACKAGES.some((pattern) =>
    pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  );
}

// node-semver's range grammar (https://github.com/npm/node-semver#range-grammar),
// strictly: a number part is 0 or has no leading zero, and a partial is
// numbers or x/X/* separated by dots. A dist-tag ("latest", "5next") is not
// a range: it names whatever the tag points at on the day of the install.
const NR = "(?:0|[1-9]\\d*)";
const XR = `(?:[xX*]|${NR})`;
const PART = "[0-9A-Za-z-]+";
const QUALIFIER = `(?:-${PART}(?:\\.${PART})*)?(?:\\+${PART}(?:\\.${PART})*)?`;
const PARTIAL = `${XR}(?:\\.${XR}(?:\\.${XR}${QUALIFIER})?)?`;
const SIMPLE = `(?:(?:[<>]=?|=|~>?|\\^)\\s*)?v?${PARTIAL}`;
const HYPHEN = `v?${PARTIAL}\\s+-\\s+v?${PARTIAL}`;
const RANGE_SET = `(?:${HYPHEN}|${SIMPLE}(?:\\s+${SIMPLE})*)`;
const RANGE = new RegExp(`^${RANGE_SET}(?:\\s*\\|\\|\\s*${RANGE_SET})*$`);

/**
 * A version range from the npm registry: "^1.2.3", "~4", ">=22 <27",
 * "5.0.0-beta.32", "1.2.3 || ^2", "1 - 2". Never an alias ("npm:other@1"),
 * a URL, a git or GitHub reference ("user/repo"), a path ("file:..") or a
 * dist-tag ("latest", "5next"): those can put any code in place of a test
 * tool.
 *
 * @param {string} text
 */
export function isRegistryRange(text) {
  return RANGE.test(text.trim());
}

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
    return isRegistryRange(text) || (isOverride && OVERRIDE_REFERENCE.test(text));
  }
  if (!isObject(value)) return false;
  if (!isOverride) return Object.values(value).every((range) => typeof range === "string" && onlyRegistryRanges(range, false));
  // overrides: { "pkg": "range" } or { "pkg": { ".": "range", "dep": "range" } }
  return Object.values(value).every((range) => onlyRegistryRanges(range, true));
}

/**
 * Every measurement package named in a package.json, as "field path" →
 * its value: in the dependency fields, and in `overrides` at any depth
 * (as a key, whatever it overrides).
 *
 * @param {Record<string, unknown>} pkg
 */
function measurementEntries(pkg) {
  /** @type {Map<string, string>} */
  const entries = new Map();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (!isObject(deps)) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (isMeasurementPackage(name)) entries.set(`${field}/${name}`, JSON.stringify(range));
    }
  }
  /** @param {unknown} node @param {string} path */
  const walk = (node, path) => {
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const here = `${path}/${key}`;
      // "pkg@1" keys name a version of pkg.
      const name = key.startsWith("@") ? `@${key.slice(1).split("@")[0]}` : key.split("@")[0];
      if (isMeasurementPackage(name ?? key)) entries.set(here, JSON.stringify(value));
      walk(value, here);
    }
  };
  walk(pkg.overrides, "overrides");
  return entries;
}

/**
 * Whether any measurement package was added, removed or changed between
 * two package.json objects.
 *
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} head
 */
function measurementChanged(base, head) {
  const before = measurementEntries(base);
  const after = measurementEntries(head);
  if (before.size !== after.size) return true;
  for (const [path, value] of after) if (before.get(path) !== value) return true;
  return false;
}

/**
 * Whether a package.json change only touches dependency versions, so the
 * pull request needs no label: every field outside
 * PACKAGE_JSON_DEPENDENCY_FIELDS is identical (same keys, same values,
 * `scripts` included), each changed dependency field holds registry version
 * ranges only, `engines` names only node and npm, and no measurement
 * package (MEASUREMENT_PACKAGES) is added, removed, changed or overridden.
 * Invalid JSON on either side counts as not only dependencies.
 *
 * @param {string} baseText
 * @param {string} headText
 */
export function packageJsonOnlyDependencies(baseText, headText) {
  try {
    const base = /** @type {unknown} */ (JSON.parse(baseText));
    const head = /** @type {unknown} */ (JSON.parse(headText));
    if (!isObject(base) || !isObject(head)) return false;
    if (measurementChanged(base, head)) return false;
    const keys = new Set([...Object.keys(base), ...Object.keys(head)]);
    for (const key of keys) {
      const same = JSON.stringify(base[key]) === JSON.stringify(head[key]);
      if (same) continue;
      if (!PACKAGE_JSON_DEPENDENCY_FIELDS.includes(key) || !(key in head)) return false;
      const value = head[key];
      if (key === "packageManager") {
        if (typeof value !== "string" || !NPM_RELEASE.test(value)) return false;
        continue;
      }
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

/** Where every package in the lockfile must come from. */
export const REGISTRY_TARBALLS = "https://registry.npmjs.org/";

/** A package name as the registry allows it: lower case, optionally scoped. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
/** An exact version (no range): the only kind a lockfile entry holds. */
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * The package a lockfile entry installs: its `name` field (set for an
 * alias), else the folder after the last `node_modules/` in its path.
 *
 * @param {string} path
 * @param {Record<string, unknown>} entry
 */
function lockedName(path, entry) {
  return typeof entry.name === "string" ? entry.name : (path.split("node_modules/").at(-1) ?? "");
}

/**
 * The one tarball the registry serves for a package at a version:
 * https://registry.npmjs.org/<name>/-/<basename>-<version>.tgz, where
 * <basename> drops the scope ("@vitest/coverage-v8" -> "coverage-v8").
 * Null when the name or version is not one the registry could hold.
 *
 * @param {string} name
 * @param {unknown} version
 */
export function registryTarball(name, version) {
  if (!PACKAGE_NAME.test(name) || typeof version !== "string" || !EXACT_VERSION.test(version)) return null;
  return `${REGISTRY_TARBALLS}${name}/-/${name.split("/").pop()}-${version}.tgz`;
}

/**
 * Whether a package-lock.json change is a plain dependency bump, so it
 * needs no label:
 *
 * - every package the head lockfile installs resolves to exactly the
 *   registry tarball of its own name and version (registryTarball): not
 *   another host, git, a file or a link, and not another version's or
 *   another package's tarball under the right version number;
 * - no measurement package changed, appeared or went anywhere in the tree:
 *   its name, version, tarball and integrity hash are compared together,
 *   by path and by the package installed (an alias counts).
 *
 * Anything that is not a version 2/3 lockfile on either side counts as not
 * safe.
 *
 * @param {string} baseText
 * @param {string} headText
 */
export function lockfileChangeIsSafe(baseText, headText) {
  try {
    const base = /** @type {unknown} */ (JSON.parse(baseText));
    const head = /** @type {unknown} */ (JSON.parse(headText));
    if (!isObject(base) || !isObject(head) || !isObject(base.packages) || !isObject(head.packages)) return false;
    for (const [path, entry] of Object.entries(head.packages)) {
      if (path === "") continue;
      if (!isObject(entry) || entry.link === true) return false;
      const tarball = registryTarball(lockedName(path, entry), entry.version);
      if (tarball === null || entry.resolved !== tarball) return false;
    }
    /** @param {Record<string, unknown>} packages */
    const measured = (packages) => {
      /** @type {Map<string, string>} */
      const entries = new Map();
      for (const [path, entry] of Object.entries(packages)) {
        if (path === "") continue;
        const folder = path.split("node_modules/").at(-1) ?? "";
        const record = isObject(entry) ? entry : {};
        if (!isMeasurementPackage(folder) && !isMeasurementPackage(lockedName(path, record))) continue;
        entries.set(
          path,
          JSON.stringify([record.name ?? null, record.version ?? null, record.resolved ?? null, record.integrity ?? null]),
        );
      }
      return entries;
    };
    const before = measured(base.packages);
    const after = measured(head.packages);
    if (before.size !== after.size) return false;
    for (const [path, locked] of after) if (before.get(path) !== locked) return false;
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
 * @param {{ changed: readonly string[], exception: boolean, thresholdsRaisedOnly: boolean, packageDependenciesOnly?: boolean, lockfileSafe?: boolean }} input
 */
export function evaluate({ changed, exception, thresholdsRaisedOnly, packageDependenciesOnly = false, lockfileSafe = false }) {
  const matches = protectedChanges(changed).filter(
    (file) =>
      !(file === "coverage-thresholds.json" && thresholdsRaisedOnly) &&
      !(file === "package.json" && packageDependenciesOnly) &&
      !(file === "package-lock.json" && lockfileSafe),
  );
  const lines = ["### Test bar guard", ""];
  if (thresholdsRaisedOnly && changed.includes("coverage-thresholds.json")) {
    lines.push("coverage-thresholds.json changed, and only upward: allowed without the label.", "");
  }
  if (packageDependenciesOnly && changed.some((file) => file.trim() === "package.json")) {
    lines.push("package.json changed, in dependency versions only (no scripts or other fields): allowed without the label.", "");
  }
  if (lockfileSafe && changed.some((file) => file.trim() === "package-lock.json")) {
    lines.push("package-lock.json changed: every package from the npm registry, no test tool's version changed. Allowed without the label.", "");
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
      "lock-base": { type: "string" },
      "lock-head": { type: "string" },
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

  const lockBase = values["lock-base"];
  const lockHead = values["lock-head"];
  const lockfileSafe =
    !!lockBase && !!lockHead && lockfileChangeIsSafe(readFileSync(lockBase, "utf8"), readFileSync(lockHead, "utf8"));

  const result = evaluate({
    changed,
    exception: process.env.HAS_EXCEPTION === "true",
    lockfileSafe,
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
