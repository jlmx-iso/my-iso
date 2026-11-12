#!/usr/bin/env node
// Coverage guard: the bar may only rise. Compares this branch with the base
// branch and fails if
//
//   - any threshold in coverage-thresholds.json is lower, or a threshold
//     (or a whole per-directory entry) was removed;
//   - coverage.config.mjs measures less: an include pattern removed, an
//     exclusion glob added, the route-file rule changed, or, whatever the
//     code looks like, any file under src/ that the base's rules measure
//     and the head's do not. Both copies of the module (the base's from
//     git) are evaluated against this tree;
//   - the base has no coverage-thresholds.json or coverage.config.mjs
//     (except with --bootstrap, which CI passes only while the base
//     predates this guard);
//
// unless the pull request carries the `coverage-exception` label (CI passes
// --exception then; docs/TESTING.md).
//
//   node scripts/coverage-guard.mjs                       # against origin/main
//   node scripts/coverage-guard.mjs --base origin/main --exception

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/**
 * Thresholds as "key metric" -> number: "global lines", "src/x/** branches".
 *
 * @param {Record<string, unknown>} thresholds
 * @returns {Map<string, number>}
 */
export function flattenThresholds(thresholds) {
  /** @type {Map<string, number>} */
  const flat = new Map();
  for (const [key, value] of Object.entries(thresholds)) {
    if (typeof value === "number") flat.set(`global ${key}`, value);
    else if (value && typeof value === "object") {
      for (const [metric, number] of Object.entries(value)) {
        if (typeof number === "number") flat.set(`${key} ${metric}`, number);
      }
    }
  }
  return flat;
}

/**
 * What got weaker from `base` to `head`.
 *
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} head
 * @returns {string[]}
 */
export function compareThresholds(base, head) {
  const before = flattenThresholds(base);
  const after = flattenThresholds(head);
  /** @type {string[]} */
  const problems = [];
  for (const [key, was] of before) {
    const now = after.get(key);
    if (now === undefined) problems.push(`threshold removed: ${key} (was ${was})`);
    else if (now < was) problems.push(`threshold lowered: ${key} ${was} -> ${now}`);
  }
  return problems;
}


/**
 * What a coverage.config.mjs exports (see that file).
 *
 * @typedef {{
 *   COVERAGE_EXCLUDE_GLOBS: readonly string[],
 *   COVERAGE_INCLUDE: readonly string[],
 *   ROUTE_CONVENTION_GLOB: string,
 *   coverageExclude: (root: string) => string[],
 *   coverageStatus: (file: string, exclude: readonly string[]) => "measured" | "excluded" | "outside",
 * }} CoverageRules
 */

/**
 * Rule changes from `base` to `head` that can measure less: an include
 * pattern dropped, an exclusion glob added, the route-file rule changed.
 *
 * @param {Pick<CoverageRules, "COVERAGE_EXCLUDE_GLOBS" | "COVERAGE_INCLUDE" | "ROUTE_CONVENTION_GLOB">} base
 * @param {Pick<CoverageRules, "COVERAGE_EXCLUDE_GLOBS" | "COVERAGE_INCLUDE" | "ROUTE_CONVENTION_GLOB">} head
 * @returns {string[]}
 */
export function compareRules(base, head) {
  /** @type {string[]} */
  const problems = [];
  for (const glob of base.COVERAGE_INCLUDE) {
    if (!head.COVERAGE_INCLUDE.includes(glob)) problems.push(`include pattern removed: ${glob}`);
  }
  for (const glob of head.COVERAGE_EXCLUDE_GLOBS) {
    if (!base.COVERAGE_EXCLUDE_GLOBS.includes(glob)) problems.push(`exclusion added: ${glob}`);
  }
  if (head.ROUTE_CONVENTION_GLOB !== base.ROUTE_CONVENTION_GLOB) {
    problems.push(`route-file exclusion rule changed: ${base.ROUTE_CONVENTION_GLOB} -> ${head.ROUTE_CONVENTION_GLOB}`);
  }
  return problems;
}

/**
 * Files the base rules measure and the head rules do not, both evaluated
 * against the same tree: what the change actually stops measuring,
 * whatever the code that decides it looks like.
 *
 * @param {readonly string[]} files  repo-relative paths in the head tree
 * @param {(file: string) => string} baseStatus
 * @param {(file: string) => string} headStatus
 * @returns {string[]}
 */
export function compareMeasured(files, baseStatus, headStatus) {
  /** @type {string[]} */
  const problems = [];
  for (const file of files) {
    if (baseStatus(file) !== "measured") continue;
    const now = headStatus(file);
    if (now !== "measured") problems.push(`no longer measured (${now}): ${file}`);
  }
  return problems;
}

/**
 * Every file under `dir`, as paths relative to `root`.
 *
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(root, dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(root, relative));
    else files.push(relative);
  }
  return files;
}

/**
 * The file at `ref`, or null if it does not exist there.
 *
 * @param {string} ref
 * @param {string} file
 */
function showAt(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * Loads a copy of coverage.config.mjs from its source text (the base
 * branch's, from git; it imports only node: modules).
 *
 * @param {string} source
 * @returns {Promise<CoverageRules>}
 */
async function loadRules(source) {
  const dir = mkdtempSync(path.join(tmpdir(), "coverage-guard-"));
  try {
    const file = path.join(dir, "coverage.config.mjs");
    writeFileSync(file, source);
    /** @type {unknown} */
    const loaded = await import(pathToFileURL(file).href);
    return /** @type {CoverageRules} */ (loaded);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function parseJson(text) {
  return JSON.parse(text);
}

const GUARDED = ["coverage-thresholds.json", "coverage.config.mjs"];

async function main() {
  const { values } = parseArgs({
    options: {
      base: { default: "origin/main", type: "string" },
      // Only for the pull request that introduces this guard: the base
      // predates it, so there is nothing to compare against yet. CI passes
      // it only when the base has no coverage.config.mjs.
      bootstrap: { default: false, type: "boolean" },
      exception: { default: false, type: "boolean" },
    },
  });
  const root = process.cwd();
  /** @type {string[]} */
  const problems = [];

  const baseThresholds = showAt(values.base, "coverage-thresholds.json");
  const baseConfig = showAt(values.base, "coverage.config.mjs");

  if (baseThresholds === null || baseConfig === null) {
    const missing = GUARDED.filter((_, i) => (i === 0 ? baseThresholds : baseConfig) === null);
    if (values.bootstrap) {
      console.log(`${values.base} predates the coverage guard (no ${missing.join(", ")}): bootstrap run, nothing to compare.`);
      return;
    }
    problems.push(`${values.base} has no ${missing.join(", ")}: nothing to compare against`);
  } else {
    const headThresholds = /** @type {Record<string, unknown>} */ (
      parseJson(readFileSync(path.join(root, "coverage-thresholds.json"), "utf8"))
    );
    problems.push(...compareThresholds(/** @type {Record<string, unknown>} */ (parseJson(baseThresholds)), headThresholds));

    const base = await loadRules(baseConfig);
    const head = await loadRules(readFileSync(path.join(root, "coverage.config.mjs"), "utf8"));
    problems.push(...compareRules(base, head));
    // Both rule sets evaluated on this tree.
    const baseExclude = base.coverageExclude(root);
    const headExclude = head.coverageExclude(root);
    problems.push(
      ...compareMeasured(
        listFiles(root, "src"),
        (file) => base.coverageStatus(file, baseExclude),
        (file) => head.coverageStatus(file, headExclude),
      ),
    );
  }

  if (problems.length === 0) {
    console.log(`Coverage guard: nothing lowered, and nothing measured less, against ${values.base}.`);
    return;
  }
  for (const problem of problems) console.log(`  ${problem}`);
  if (values.exception) {
    console.log("Allowed: the pull request has the `coverage-exception` label.");
    return;
  }
  console.error(
    `Coverage guard: the bar was lowered against ${values.base}. Raise coverage instead, or, if this ` +
      "is deliberate, add the `coverage-exception` label to the pull request and say why (docs/TESTING.md).",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
