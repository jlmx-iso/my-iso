#!/usr/bin/env node
// Coverage guard: the bar may only rise. Compares this branch with the base
// branch and fails if
//
//   - any threshold in coverage-thresholds.json is lower, or a threshold
//     (or a whole per-directory entry) was removed;
//   - coverage.config.mjs excludes more: a glob added to
//     COVERAGE_EXCLUDE_GLOBS, or the route-file rule changed;
//
// unless the pull request carries the `coverage-exception` label (CI passes
// --exception then; docs/TESTING.md).
//
//   npm run coverage:guard                       # against origin/main
//   npm run coverage:guard -- --base origin/main --exception

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 * @typedef {{ globs: readonly string[], routeGlob: string }} ExcludeRules
 */

/**
 * Exclusions added from `base` to `head`.
 *
 * @param {ExcludeRules} base
 * @param {ExcludeRules} head
 * @returns {string[]}
 */
export function compareExcludes(base, head) {
  /** @type {string[]} */
  const problems = [];
  for (const glob of head.globs) {
    if (!base.globs.includes(glob)) problems.push(`exclusion added: ${glob}`);
  }
  if (head.routeGlob !== base.routeGlob) {
    problems.push(`route-file exclusion rule changed: ${base.routeGlob} -> ${head.routeGlob}`);
  }
  return problems;
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
 * Loads a copy of coverage.config.mjs from its source text.
 *
 * @param {string} source
 * @returns {Promise<ExcludeRules>}
 */
async function loadRules(source) {
  const dir = mkdtempSync(path.join(tmpdir(), "coverage-guard-"));
  try {
    const file = path.join(dir, "coverage.config.mjs");
    writeFileSync(file, source);
    /** @type {unknown} */
    const loaded = await import(pathToFileURL(file).href);
    const rules = /** @type {{ COVERAGE_EXCLUDE_GLOBS: string[], ROUTE_CONVENTION_GLOB: string }} */ (loaded);
    return { globs: rules.COVERAGE_EXCLUDE_GLOBS, routeGlob: rules.ROUTE_CONVENTION_GLOB };
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

async function main() {
  const { values } = parseArgs({
    options: {
      base: { default: "origin/main", type: "string" },
      exception: { default: false, type: "boolean" },
    },
  });
  const root = process.cwd();
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];

  const baseThresholds = showAt(values.base, "coverage-thresholds.json");
  if (baseThresholds === null) notes.push(`${values.base} has no coverage-thresholds.json: no thresholds to compare.`);
  else {
    const head = /** @type {Record<string, unknown>} */ (parseJson(readFileSync(path.join(root, "coverage-thresholds.json"), "utf8")));
    problems.push(...compareThresholds(/** @type {Record<string, unknown>} */ (parseJson(baseThresholds)), head));
  }

  const baseConfig = showAt(values.base, "coverage.config.mjs");
  if (baseConfig === null) notes.push(`${values.base} has no coverage.config.mjs: no exclusions to compare.`);
  else {
    const head = await loadRules(readFileSync(path.join(root, "coverage.config.mjs"), "utf8"));
    problems.push(...compareExcludes(await loadRules(baseConfig), head));
  }

  for (const note of notes) console.log(note);
  if (problems.length === 0) {
    console.log(`Coverage guard: nothing lowered or newly excluded against ${values.base}.`);
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
