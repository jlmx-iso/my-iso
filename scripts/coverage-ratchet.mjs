#!/usr/bin/env node
// Raises the coverage thresholds in coverage-thresholds.json to what the
// suite now measures, rounded down to the integer. Never lowers one.
//
//   npm run test:coverage          # writes coverage/coverage-summary.json
//   npm run coverage:ratchet       # rewrites coverage-thresholds.json
//   npm run coverage:ratchet -- --check   # only report, exit 1 if it would change
//
// Run it after a change that adds tests, and commit the updated JSON with
// that change, so the bar only climbs (docs/TESTING.md).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const METRICS = /** @type {const} */ (["branches", "functions", "lines", "statements"]);

/**
 * @typedef {(typeof METRICS)[number]} Metric
 * @typedef {Record<Metric, { covered: number, total: number }>} SummaryEntry
 * @typedef {Record<string, SummaryEntry>} Summary
 * @typedef {Partial<Record<Metric, number>>} MetricThresholds
 * @typedef {MetricThresholds & Record<string, unknown>} Thresholds
 * @typedef {{ from: number, label: string, metric: Metric, to: number }} Change
 */

/**
 * Sums covered/total per metric over the summary's files that match `glob`
 * (paths relative to `root`), and returns percentages. A metric with nothing
 * to measure counts as 100%, the way Vitest treats it.
 *
 * @param {Summary} summary
 * @param {string} root
 * @param {string | null} glob
 * @returns {Record<Metric, number>}
 */
export function aggregate(summary, root, glob) {
  /** @type {SummaryEntry} */
  const sums = {
    branches: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 },
    statements: { covered: 0, total: 0 },
  };
  for (const [file, entry] of Object.entries(summary)) {
    if (file === "total") continue;
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (glob && !path.matchesGlob(relative, glob)) continue;
    for (const m of METRICS) {
      sums[m].covered += entry[m].covered;
      sums[m].total += entry[m].total;
    }
  }
  /** @param {Metric} m */
  const pct = (m) => (sums[m].total === 0 ? 100 : (100 * sums[m].covered) / sums[m].total);
  return { branches: pct("branches"), functions: pct("functions"), lines: pct("lines"), statements: pct("statements") };
}

/**
 * Returns the thresholds raised to the measured values (rounded down), and
 * the list of changes. Keys that are not metrics or globs are kept as they are.
 *
 * @param {Thresholds} thresholds
 * @param {Summary} summary
 * @param {string} root
 * @returns {{ changes: Change[], next: Thresholds }}
 */
export function ratchet(thresholds, summary, root) {
  const next = structuredClone(thresholds);
  /** @type {Change[]} */
  const changes = [];
  /**
   * @param {MetricThresholds} target
   * @param {Record<Metric, number>} measured
   * @param {string} label
   */
  const raise = (target, measured, label) => {
    for (const m of METRICS) {
      if (typeof target[m] !== "number") continue;
      const floor = Math.floor(measured[m]);
      if (floor > target[m]) {
        changes.push({ from: target[m], label, metric: m, to: floor });
        target[m] = floor;
      }
    }
  };

  raise(next, aggregate(summary, root, null), "global");
  for (const [key, value] of Object.entries(next)) {
    if (/** @type {readonly string[]} */ (METRICS).includes(key)) continue;
    if (typeof value !== "object" || value === null) continue;
    raise(/** @type {MetricThresholds} */ (value), aggregate(summary, root, key), key);
  }
  return { changes, next };
}

/**
 * @param {string} file
 * @returns {unknown}
 */
function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function main() {
  const root = process.cwd();
  const check = process.argv.includes("--check");
  const thresholdsPath = path.join(root, "coverage-thresholds.json");
  const summaryPath = path.join(root, "coverage", "coverage-summary.json");

  /** @type {Summary} */
  let summary;
  try {
    summary = /** @type {Summary} */ (readJson(summaryPath));
  } catch {
    console.error(`No ${path.relative(root, summaryPath)}: run \`npm run test:coverage\` first.`);
    process.exit(2);
  }
  const thresholds = /** @type {Thresholds} */ (readJson(thresholdsPath));
  const { changes, next } = ratchet(thresholds, summary, root);

  if (changes.length === 0) {
    console.log("Coverage thresholds are already at the measured values.");
    return;
  }
  for (const c of changes) {
    console.log(`${c.label} ${c.metric}: ${c.from} -> ${c.to}`);
  }
  if (check) {
    console.log("\nRun `npm run coverage:ratchet` and commit coverage-thresholds.json.");
    process.exit(1);
  }
  writeFileSync(thresholdsPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\nUpdated ${path.relative(root, thresholdsPath)}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
