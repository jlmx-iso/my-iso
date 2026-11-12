#!/usr/bin/env node
// Bundles the Worker exactly as `wrangler deploy` would (dry run, nothing is
// uploaded) and fails if the result would not deploy or run:
//
//   1. the gzip size wrangler reports must stay within the budget. Cloudflare
//      rejects Workers over 10 MiB gzipped on the paid plan, so the default
//      budget of 9.5 MiB leaves headroom to react before deploys break;
//   2. the Prisma query compiler must be present as a WASM module. wrangler
//      picks it up from the dynamic `import("...query_compiler_*.wasm")` in
//      the OpenNext handler; without it every database call fails at runtime.
//
// Run after `npm run build:cf`. Usage:
//   node scripts/check-worker-bundle.mjs [--outdir <dir>] [--budget-kib <n>]

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_BUDGET_KIB = 9.5 * 1024;

const { values } = parseArgs({
  options: {
    "budget-kib": { type: "string" },
    outdir: { type: "string" },
  },
});

const budgetKiB = values["budget-kib"]
  ? Number(values["budget-kib"])
  : DEFAULT_BUDGET_KIB;
if (!Number.isFinite(budgetKiB) || budgetKiB <= 0) {
  fail(`Invalid --budget-kib value: ${values["budget-kib"]}`);
}
const outdir =
  values.outdir ?? mkdtempSync(path.join(tmpdir(), "worker-bundle-"));

// `--env=` targets the top-level (production) environment explicitly.
const wrangler = spawnSync(
  "npx",
  ["wrangler", "deploy", "--dry-run", "--env=", "--outdir", outdir],
  { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } }
);
const output = `${wrangler.stdout ?? ""}${wrangler.stderr ?? ""}`;
process.stdout.write(output);
if (wrangler.status !== 0) {
  fail(`wrangler deploy --dry-run exited with status ${wrangler.status}`);
}

const sizeMatch = /Total Upload: ([\d.]+) KiB \/ gzip: ([\d.]+) KiB/.exec(
  output
);
if (!sizeMatch) {
  fail(
    "Could not find the 'Total Upload: … / gzip: …' line in wrangler's output."
  );
}
const gzipKiB = Number(sizeMatch[2]);

const wasmModules = readdirSync(outdir).filter((file) =>
  /query_compiler.*\.wasm$/.test(file)
);
if (wasmModules.length === 0) {
  fail(
    `No Prisma query compiler WASM module in ${outdir}. ` +
      "The OpenNext handler no longer imports it in a form wrangler can bundle."
  );
}

console.log(
  `\nWorker bundle: ${toMiB(gzipKiB)} MiB gzipped ` +
    `(budget ${toMiB(budgetKiB)} MiB, Cloudflare limit 10 MiB)`
);
console.log(`Prisma WASM module: ${wasmModules.join(", ")}`);

if (gzipKiB > budgetKiB) {
  fail(
    `Worker bundle is ${toMiB(gzipKiB)} MiB gzipped, over the ` +
      `${toMiB(budgetKiB)} MiB budget.`
  );
}

/** @param {number} kib */
function toMiB(kib) {
  return (kib / 1024).toFixed(2);
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`\ncheck-worker-bundle: ${message}`);
  process.exit(1);
}
