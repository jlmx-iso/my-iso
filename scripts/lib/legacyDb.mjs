// The pure parts of the pre-baseline database upgrade, shared by
// scripts/db-upgrade-legacy.mjs, scripts/deploy.mjs and their tests
// (src/server/_db/legacyUpgrade.test.ts, scripts/lib/legacyDb.test.ts).
//
// Nothing here talks to Cloudflare. Schemas are compared by loading SQL into
// an in-memory SQLite database (better-sqlite3, the engine the tests use)
// and reading back what SQLite stored, so no sqlite3 binary is needed.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "migrations");
export const BASELINE_MIGRATION = "0001_init.sql";
export const UPGRADE_FILE = path.join(MIGRATIONS_DIR, "legacy", "upgrade-pre-baseline.sql");
export const PRE_BASELINE_SCHEMA_FILE = path.join(MIGRATIONS_DIR, "legacy", "pre-baseline-schema.sql");

/** wrangler's flags for each deployment (wrangler.toml: production is the top level). */
export const WRANGLER_ENV_ARGS = /** @type {const} */ ({
  production: ["--env="],
  staging: ["--env", "staging"],
});

/** @typedef {keyof typeof WRANGLER_ENV_ARGS} DeployEnv */

const USAGE = "Usage: npm run db:upgrade-legacy -- --env <staging|production> [--yes]";

/**
 * Arguments of scripts/db-upgrade-legacy.mjs. Throws with the usage line on
 * anything it does not understand: this script changes a real database.
 *
 * @param {readonly string[]} argv  process.argv.slice(2)
 * @returns {{ env: DeployEnv, yes: boolean }}
 */
export function parseUpgradeArgs(argv) {
  /** @type {string | undefined} */
  let env;
  let yes = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--yes") {
      yes = true;
    } else if (arg === "--env") {
      env = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--env=")) {
      env = arg.slice("--env=".length);
    } else {
      throw new Error(`Unknown argument "${arg}".\n${USAGE}`);
    }
  }
  if (env !== "staging" && env !== "production") {
    throw new Error(`--env must be staging or production.\n${USAGE}`);
  }
  return { env, yes };
}

/**
 * Where a backup of `env` taken at `date` is written (backups/ is
 * gitignored). Colons are left out so the name is valid everywhere.
 *
 * @param {DeployEnv} env
 * @param {Date} date
 */
export function backupPath(env, date) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return path.join("backups", `${env}-${stamp}.sql`);
}

/** The state of a database as far as migrations are concerned. */
export const PROBE_TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('User', 'd1_migrations') ORDER BY name";
export const PROBE_BASELINE_SQL = `SELECT COUNT(*) AS applied FROM d1_migrations WHERE name = '${BASELINE_MIGRATION}'`;

/**
 * - "empty": no app tables; `migrations apply` creates everything.
 * - "pre-baseline": app tables, but 0001_init.sql was never recorded. Applying
 *   migrations would fail on 0001's first CREATE TABLE; the database needs
 *   `npm run db:upgrade-legacy` first.
 * - "migrated": the baseline is recorded; migrations apply normally.
 *
 * @param {{ tables: readonly string[], baselineApplied: boolean }} probe
 * @returns {"empty" | "pre-baseline" | "migrated"}
 */
export function classifyDatabase(probe) {
  if (probe.baselineApplied) return "migrated";
  return probe.tables.includes("User") ? "pre-baseline" : "empty";
}

/**
 * The rows of the first result of `wrangler d1 execute --json`, which prints
 * an array of `{ results, success, meta }`. Tolerates log lines before it.
 *
 * @param {string} stdout
 * @returns {Record<string, unknown>[]}
 */
export function parseWranglerJson(stdout) {
  const start = stdout.indexOf("[");
  if (start === -1) throw new Error(`No JSON in wrangler's output:\n${stdout}`);
  /** @type {unknown} */
  const parsed = JSON.parse(stdout.slice(start));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Unexpected wrangler output:\n${stdout}`);
  }
  /** @type {unknown[]} */
  const results = parsed;
  const first = /** @type {{ results?: unknown, success?: unknown }} */ (results[0]);
  /** @type {unknown} */
  const rows = first.results;
  if (first.success === false || !Array.isArray(rows)) {
    throw new Error(`wrangler reported a failure:\n${stdout}`);
  }
  /** @type {unknown[]} */
  const list = rows;
  return list.filter(isRecord);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Number of duplicated groups per new unique index of the baseline: what
 * the upgrade's de-duplication will remove (docs/DATABASE.md).
 */
export const DUPLICATE_COUNTS_SQL = `SELECT 'EventLike (eventId, userId)' AS "index", COUNT(*) AS "duplicatedGroups" FROM (
  SELECT 1 FROM "EventLike" GROUP BY "eventId", "userId" HAVING COUNT(*) > 1
)
UNION ALL SELECT 'CommentLike (commentId, userId)', COUNT(*) FROM (
  SELECT 1 FROM "CommentLike" GROUP BY "commentId", "userId" HAVING COUNT(*) > 1
)
UNION ALL SELECT 'Review (photographerId, userId)', COUNT(*) FROM (
  SELECT 1 FROM "Review" GROUP BY "photographerId", "userId" HAVING COUNT(*) > 1
)
UNION ALL SELECT 'InviteRedemption (redeemedById)', COUNT(*) FROM (
  SELECT 1 FROM "InviteRedemption" GROUP BY "redeemedById" HAVING COUNT(*) > 1
)
UNION ALL SELECT 'VerificationToken (pending codes, all discarded)', COUNT(*) FROM "VerificationToken"`;

/**
 * Objects that are not part of the app's schema.
 *
 * @param {string} name
 */
function isAppObject(name) {
  return !name.startsWith("sqlite_") && !name.startsWith("_cf_") && name !== "d1_migrations";
}

/**
 * One SQL definition in a form that does not depend on layout: whitespace
 * collapsed, none around parentheses and commas. (ALTER TABLE ... ADD
 * COLUMN appends to the stored CREATE TABLE text with its own spacing.)
 *
 * @param {string} sql
 */
export function normaliseSql(sql) {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

/**
 * Statements in a `wrangler d1 export` that cannot be replayed into a fresh
 * SQLite database and say nothing about the app's schema: D1's internal
 * tables and the AUTOINCREMENT bookkeeping table.
 */
const NOT_REPLAYABLE = /^\s*(?:CREATE TABLE|INSERT INTO|DELETE FROM)\s+(?:IF NOT EXISTS\s+)?["`]?(?:sqlite_sequence|_cf_)/i;

/** @param {string} sql */
function replayable(sql) {
  return sql
    .split("\n")
    .filter((line) => !NOT_REPLAYABLE.test(line))
    .join("\n");
}

/**
 * The schema of a live SQLite database: every table, index and trigger of
 * the app, normalised, sorted.
 *
 * @param {import("better-sqlite3").Database} db
 * @returns {string[]}
 */
export function schemaOfDatabase(db) {
  const rows = /** @type {{ type: string, name: string, tbl_name: string, sql: string | null }[]} */ (
    db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all()
  );
  return rows
    .filter((row) => isAppObject(row.name) && row.sql !== null)
    .map((row) => `${row.type} ${row.name} ON ${row.tbl_name}: ${normaliseSql(row.sql ?? "")}`);
}

/**
 * The schema that SQL text (migration files, a schema export) produces in
 * an empty database.
 *
 * @param {readonly string[]} sqlTexts  applied in order
 * @returns {string[]}
 */
export function schemaOfSql(sqlTexts) {
  const db = new Database(":memory:");
  try {
    for (const sql of sqlTexts) db.exec(replayable(sql));
    return schemaOfDatabase(db);
  } finally {
    db.close();
  }
}

/**
 * What differs between two schemas (as from schemaOf*).
 *
 * @param {readonly string[]} actual
 * @param {readonly string[]} expected
 */
export function compareSchemas(actual, expected) {
  const have = new Set(actual);
  const want = new Set(expected);
  const missing = expected.filter((entry) => !have.has(entry));
  const unexpected = actual.filter((entry) => !want.has(entry));
  return { equal: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}

/**
 * A comparison as lines a person can act on.
 *
 * @param {{ missing: readonly string[], unexpected: readonly string[] }} difference
 */
export function describeDifference(difference) {
  return [
    ...difference.missing.map((entry) => `  missing:    ${entry}`),
    ...difference.unexpected.map((entry) => `  unexpected: ${entry}`),
  ].join("\n");
}

/** Migration files wrangler applies, in its order (migrations/*.sql, by name). */
export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** @param {string} file  a path */
export function readSql(file) {
  return readFileSync(file, "utf8");
}

/** The baseline schema: 0001_init.sql applied to an empty database. */
export function baselineSchema() {
  return schemaOfSql([readSql(path.join(MIGRATIONS_DIR, BASELINE_MIGRATION))]);
}

/** The schema a pre-baseline database must have before the upgrade. */
export function preBaselineSchema() {
  return schemaOfSql([readSql(PRE_BASELINE_SCHEMA_FILE)]);
}
