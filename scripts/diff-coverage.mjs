#!/usr/bin/env node
// Diff coverage: of the lines a change adds or edits under src/ (tests
// excluded), at least --threshold percent must be run by the test suite.
//
//   npm run test:coverage                      # writes coverage/lcov.info
//   npm run coverage:diff                      # against origin/main
//   npm run coverage:diff -- --base main --threshold 90
//
// Only lines the coverage report counts as executable are measured: comments,
// blank lines, types and imports are not. Changed files that coverage.config.mjs
// excludes are listed as a warning but not measured. It fails closed: a
// coverage report with no src/ file, or a changed file that should be
// measured but has no record, fails the run. CI runs this on pull requests
// (docs/TESTING.md).

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { coverageExclude, coverageStatus } from "../coverage.config.mjs";

const C_ESCAPES = /** @type {Record<string, number>} */ ({
  '"': 0x22,
  "\\": 0x5c,
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
});

/**
 * Git writes a path with non-ASCII bytes, quotes, backslashes or control
 * characters C-style quoted: `"b/src/caf\303\251.ts"`. Returns the path
 * as it is on disk (octal escapes are UTF-8 bytes). An unquoted path is
 * returned as it is.
 *
 * @param {string} text
 */
export function unquoteGitPath(text) {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  /** @type {number[]} */
  const bytes = [];
  const body = text.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char !== "\\") {
      bytes.push(...Buffer.from(/** @type {string} */ (char), "utf8"));
      continue;
    }
    const next = body[i + 1] ?? "";
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else if (next in C_ESCAPES) {
      bytes.push(/** @type {number} */ (C_ESCAPES[next]));
      i += 1;
    } else {
      bytes.push(0x5c);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Parses `git diff --unified=0` output into the new-side line numbers each
 * file gains. Deleted files are skipped; renamed files use their new path.
 *
 * @param {string} diff
 * @returns {Map<string, Set<number>>}
 */
export function parseDiff(diff) {
  /** @type {Map<string, Set<number>>} */
  const changed = new Map();
  /** @type {Set<number> | null} */
  let current = null;
  let nextLine = 0;
  // File headers ("--- a/x", "+++ b/x") only appear between "diff --git" and
  // the first hunk; inside a hunk, an added line "++ x" reads "+++ x".
  let inHeader = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null;
      inHeader = true;
      continue;
    }
    if (inHeader && line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") {
        current = null;
        continue;
      }
      const unquoted = unquoteGitPath(target);
      const file = unquoted.startsWith("b/") ? unquoted.slice(2) : unquoted;
      current = changed.get(file) ?? new Set();
      changed.set(file, current);
      continue;
    }
    if (inHeader && line.startsWith("--- ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inHeader = false;
      nextLine = Number(hunk[1]);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+")) {
      current.add(nextLine);
      nextLine += 1;
    }
    // With --unified=0 there are no context lines, and "-" lines do not
    // advance the new side.
  }

  for (const [file, lines] of changed) {
    if (lines.size === 0) changed.delete(file);
  }
  return changed;
}

/**
 * Parses an lcov report into line hit counts per file, keyed by the path
 * relative to `root`.
 *
 * @param {string} lcov
 * @param {string} root
 * @returns {Map<string, Map<number, number>>}
 */
export function parseLcov(lcov, root) {
  /** @type {Map<string, Map<number, number>>} */
  const files = new Map();
  /** @type {Map<number, number> | null} */
  let current = null;

  for (const raw of lcov.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      const source = line.slice(3);
      const relative = path.isAbsolute(source) ? path.relative(root, source) : source;
      current = new Map();
      files.set(relative.split(path.sep).join("/"), current);
    } else if (line.startsWith("DA:") && current) {
      const [lineNo, hits] = line.slice(3).split(",");
      const n = Number(lineNo);
      // A line can be listed more than once (one entry per statement).
      current.set(n, Math.max(current.get(n) ?? 0, Number(hits)));
    } else if (line === "end_of_record") {
      current = null;
    }
  }
  return files;
}

/**
 * Whether a changed file is product code under src/ (not a test).
 *
 * @param {string} file
 */
export function isMeasuredSource(file) {
  if (!file.startsWith("src/")) return false;
  if (file.startsWith("src/test/")) return false;
  return !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/**
 * Collapses sorted line numbers into "3-5, 9" ranges.
 *
 * @param {number[]} lines
 */
export function formatRanges(lines) {
  const sorted = [...lines].sort((a, b) => a - b);
  /** @type {string[]} */
  const parts = [];
  let i = 0;
  while (i < sorted.length) {
    const start = /** @type {number} */ (sorted[i]);
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
      i += 1;
      end = end + 1;
    }
    parts.push(start === end ? `${start}` : `${start}-${end}`);
    i += 1;
  }
  return parts.join(", ");
}

/**
 * @typedef {{ file: string, covered: number, total: number, uncovered: number[] }} FileResult
 * @typedef {{
 *   covered: number,
 *   excluded: string[],
 *   failures: string[],
 *   files: FileResult[],
 *   missing: string[],
 *   percent: number,
 *   total: number,
 * }} DiffCoverage
 * @typedef {(file: string) => "measured" | "excluded" | "outside"} CoverageStatus
 */

/**
 * The threshold argument as a percentage, or an error.
 *
 * @param {string | undefined} value
 * @returns {number}
 */
export function parseThreshold(value) {
  const threshold = Number(value);
  if (value === undefined || value.trim() === "" || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error(`--threshold must be a number from 0 to 100, got ${JSON.stringify(value)}`);
  }
  return threshold;
}

/**
 * Intersects changed lines with coverage. Fails closed: a report without
 * any src/ file, or a changed file coverage should measure but has no
 * record of, is a failure, not a pass.
 *
 * @param {Map<string, Set<number>>} changed
 * @param {Map<string, Map<number, number>>} coverage
 * @param {CoverageStatus} status  how coverage.config.mjs treats a path
 * @returns {DiffCoverage}
 */
export function computeDiffCoverage(changed, coverage, status) {
  /** @type {FileResult[]} */
  const files = [];
  /** @type {string[]} */
  const excluded = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const failures = [];
  let covered = 0;
  let total = 0;

  if (![...coverage.keys()].some((file) => file.startsWith("src/"))) {
    failures.push("The coverage report has no files under src/: it is not this project's report, or coverage did not run.");
  }

  for (const [file, lines] of [...changed].sort(([a], [b]) => a.localeCompare(b))) {
    if (!isMeasuredSource(file)) continue;
    const kind = status(file);
    if (kind === "outside") continue;
    if (kind === "excluded") {
      excluded.push(file);
      continue;
    }
    const hits = coverage.get(file);
    if (!hits) {
      missing.push(file);
      continue;
    }
    /** @type {number[]} */
    const uncovered = [];
    let fileCovered = 0;
    let fileTotal = 0;
    for (const line of lines) {
      const count = hits.get(line);
      if (count === undefined) continue; // not executable
      fileTotal += 1;
      if (count > 0) fileCovered += 1;
      else uncovered.push(line);
    }
    if (fileTotal === 0) continue;
    files.push({ covered: fileCovered, file, total: fileTotal, uncovered: uncovered.sort((a, b) => a - b) });
    covered += fileCovered;
    total += fileTotal;
  }

  if (missing.length) {
    failures.push(
      `${missing.length} changed file(s) should be measured but have no coverage record ` +
        "(was the coverage run complete?).",
    );
  }

  return { covered, excluded, failures, files, missing, percent: total === 0 ? 100 : (100 * covered) / total, total };
}

/**
 * Whether the change passes: no failure, and at least `threshold` percent.
 *
 * @param {DiffCoverage} result
 * @param {number} threshold
 */
export function passes(result, threshold) {
  return result.failures.length === 0 && result.percent >= threshold;
}

/**
 * @param {DiffCoverage} result
 * @param {number} threshold
 */
export function formatReport(result, threshold) {
  const lines = [];
  const pass = passes(result, threshold);
  for (const failure of result.failures) lines.push(`FAIL: ${failure}`);
  if (result.missing.length) {
    for (const f of result.missing) lines.push(`  no coverage record: ${f}`);
  }
  if (result.failures.length) lines.push("");
  if (result.total === 0) {
    lines.push("Diff coverage: no executable lines changed under src/ (tests excluded).");
  } else {
    lines.push(
      `Diff coverage: ${result.percent.toFixed(1)}% of ${result.total} changed executable lines ` +
        `(${result.covered} covered); required ${threshold}%. ${pass ? "PASS" : "FAIL"}`,
    );
    lines.push("");
    for (const f of result.files) {
      const pct = ((100 * f.covered) / f.total).toFixed(0).padStart(3);
      const missing = f.uncovered.length ? `  uncovered: ${formatRanges(f.uncovered)}` : "";
      lines.push(`  ${pct}%  ${f.covered}/${f.total}  ${f.file}${missing}`);
    }
  }
  if (result.excluded.length) {
    lines.push("");
    lines.push(
      "WARNING: changed but excluded from coverage (coverage.config.mjs), so not measured. " +
        "Keep logic out of these files:",
    );
    for (const f of result.excluded) lines.push(`  ${f}`);
  }
  return lines.join("\n");
}

function main() {
  const { values } = parseArgs({
    options: {
      base: { default: "origin/main", type: "string" },
      lcov: { default: "coverage/lcov.info", type: "string" },
      threshold: { default: "90", type: "string" },
    },
  });
  const root = process.cwd();
  let threshold;
  try {
    threshold = parseThreshold(values.threshold);
  } catch (error) {
    console.error(/** @type {Error} */ (error).message);
    process.exit(2);
  }
  const exclude = coverageExclude(root);

  let lcov;
  try {
    lcov = readFileSync(path.resolve(root, values.lcov), "utf8");
  } catch {
    console.error(`No ${values.lcov}: run \`npm run test:coverage\` first.`);
    process.exit(2);
  }

  // Three dots: changes on this branch since it left the base.
  const diff = execFileSync(
    "git",
    ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--find-renames", `${values.base}...HEAD`, "--", "src/"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  const result = computeDiffCoverage(parseDiff(diff), parseLcov(lcov, root), (file) =>
    coverageStatus(file, exclude),
  );
  const report = formatReport(result, threshold);
  console.log(report);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Diff coverage\n\n\`\`\`\n${report}\n\`\`\`\n`);
  }
  if (!passes(result, threshold)) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
