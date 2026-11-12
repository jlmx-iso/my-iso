#!/usr/bin/env node
// Brings a D1 database created before the migration baseline (staging and
// production, both created from main at 2d1d630) to the baseline, once.
//
//   npm run db:upgrade-legacy -- --env staging          check, back up, show what is removed
//   npm run db:upgrade-legacy -- --env staging --yes    ... and upgrade
//
// In order, stopping at the first problem:
//
//   1. refuses a database that already has the baseline recorded, or has no
//      app tables (a new database needs only `migrations apply`);
//   2. refuses unless the schema is exactly the expected pre-baseline one
//      (migrations/legacy/pre-baseline-schema.sql), so the upgrade cannot
//      half-apply to a database that differs;
//   3. exports a full backup to backups/<env>-<timestamp>.sql;
//   4. prints what the de-duplication will remove; without --yes, stops;
//   5. runs migrations/legacy/upgrade-pre-baseline.sql;
//   6. exports the schema again and checks it is exactly the baseline
//      (migrations/0001_init.sql on an empty database).
//
// Never run by the deploy script. See docs/DATABASE.md.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  backupPath,
  baselineSchema,
  classifyDatabase,
  compareSchemas,
  describeDifference,
  DUPLICATE_COUNTS_SQL,
  parseUpgradeArgs,
  parseWranglerJson,
  preBaselineSchema,
  PROBE_BASELINE_SQL,
  PROBE_TABLES_SQL,
  readSql,
  REPO_ROOT,
  schemaOfSql,
  UPGRADE_FILE,
  WRANGLER_ENV_ARGS,
} from "./lib/legacyDb.mjs";

/** @type {ReturnType<typeof parseUpgradeArgs>} */
let args;
try {
  args = parseUpgradeArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const { env, yes } = args;
const envArgs = WRANGLER_ENV_ARGS[env];

/**
 * Runs wrangler against the remote database; exits on failure.
 *
 * @param {string[]} wranglerArgs
 * @param {{ capture?: boolean }} options
 */
function wrangler(wranglerArgs, options = {}) {
  const result = spawnSync("npx", ["wrangler", ...wranglerArgs, ...envArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.capture ? ["inherit", "pipe", "inherit"] : "inherit",
  });
  if (result.status !== 0) {
    console.error(`\nStopped: wrangler ${wranglerArgs.slice(0, 2).join(" ")} failed. ${env} is unchanged by this step.`);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

/** @param {string} sql */
function query(sql) {
  return parseWranglerJson(wrangler(["d1", "execute", "DB", "--remote", "--json", "--command", sql], { capture: true }));
}

/** The schema of the remote database, exported and loaded into SQLite here. */
function remoteSchema() {
  const dir = mkdtempSync(path.join(tmpdir(), "d1-schema-"));
  try {
    const file = path.join(dir, "schema.sql");
    wrangler(["d1", "export", "DB", "--remote", "--no-data", "--output", file]);
    return schemaOfSql([readSql(file)]);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

console.warn(`\n==> Checking the ${env} database`);
const tables = query(PROBE_TABLES_SQL).map((row) => String(row.name));
const baselineApplied =
  tables.includes("d1_migrations") && Number(query(PROBE_BASELINE_SQL)[0]?.applied ?? 0) > 0;
const state = classifyDatabase({ baselineApplied, tables });
if (state === "migrated") {
  console.error(`${env} already has the baseline recorded. Nothing to upgrade: deploy as usual.`);
  process.exit(1);
}
if (state === "empty") {
  console.error(`${env} has no app tables. Nothing to upgrade: \`npm run deploy:${env}\` creates the schema.`);
  process.exit(1);
}

const before = compareSchemas(remoteSchema(), preBaselineSchema());
if (!before.equal) {
  console.error(
    `${env}'s schema is not the expected pre-baseline schema ` +
      "(migrations/legacy/pre-baseline-schema.sql). The upgrade was written for exactly that " +
      "one and is not run. Differences:\n" +
      describeDifference(before) +
      "\nSee docs/DATABASE.md, \"Upgrading any other database created before the baseline\".",
  );
  process.exit(1);
}
console.warn("The schema is the expected pre-baseline schema.");

const backup = backupPath(env, new Date());
mkdirSync(path.join(REPO_ROOT, "backups"), { recursive: true });
console.warn(`\n==> Backing up ${env} to ${backup}`);
wrangler(["d1", "export", "DB", "--remote", "--output", backup]);

console.warn("\n==> What the upgrade removes (duplicated groups; the upgrade keeps one row of each)");
console.table(query(DUPLICATE_COUNTS_SQL));
if (!yes) {
  console.warn(
    "\nNothing was changed. Look at the rows above (docs/DATABASE.md says which row of each group is kept), " +
      `then run again with --yes:\n  npm run db:upgrade-legacy -- --env ${env} --yes`,
  );
  process.exit(0);
}

console.warn(`\n==> Upgrading ${env}`);
wrangler(["d1", "execute", "DB", "--remote", "--yes", "--file", path.relative(REPO_ROOT, UPGRADE_FILE)]);

console.warn(`\n==> Verifying ${env}`);
const after = compareSchemas(remoteSchema(), baselineSchema());
if (!after.equal) {
  console.error(
    `${env}'s schema is not the baseline after the upgrade. Differences:\n${describeDifference(after)}\n` +
      `Do not deploy. The backup taken before the upgrade is ${backup}.`,
  );
  process.exit(1);
}
const recorded = query(PROBE_BASELINE_SQL)[0]?.applied;
if (Number(recorded ?? 0) !== 1) {
  console.error(`The baseline is not recorded in d1_migrations. Do not deploy. Backup: ${backup}.`);
  process.exit(1);
}

console.warn(
  `\n${env} now has the baseline schema, with 0001_init.sql recorded.\nNext:\n` +
    `  npm run deploy:${env}      applies the remaining migrations, then deploys\n` +
    (env === "staging" ? "  then check the app on staging before upgrading production.\n" : ""),
);
