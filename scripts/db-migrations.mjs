#!/usr/bin/env node
// Compares the committed D1 migrations with prisma/schema.prisma.
//
//   node scripts/db-migrations.mjs check   exit 1 unless they describe the same schema
//   node scripts/db-migrations.mjs diff    print the SQL that would bring the migrations
//                                          up to the schema (the body of the next migration)
//
// How: every file in migrations/ is applied, in order, to a scratch SQLite
// database; Prisma then diffs that database against the schema file. Nothing
// outside a temporary directory is read or written, and no real database is
// contacted. See docs/DATABASE.md.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "migrations");
const schemaPath = path.join("prisma", "schema.prisma");

const mode = process.argv[2];
if (mode !== "check" && mode !== "diff") {
  console.error("Usage: node scripts/db-migrations.mjs <check|diff>");
  process.exit(1);
}

/** Migration files in the order wrangler applies them (by file name). */
function listMigrations() {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No .sql files in ${migrationsDir}`);
  }
  const malformed = files.filter((name) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(name));
  if (malformed.length > 0) {
    throw new Error(
      `Migration files must be named NNNN_description.sql: ${malformed.join(", ")}`,
    );
  }
  return files;
}

/**
 * Runs `prisma migrate diff` from the scratch database to the schema.
 * @param {string} databaseFile
 * @param {string[]} extraArgs
 */
function prismaDiff(databaseFile, extraArgs) {
  return spawnSync(
    path.join(repoRoot, "node_modules", ".bin", "prisma"),
    ["migrate", "diff", "--from-config-datasource", "--to-schema", schemaPath, ...extraArgs],
    {
      cwd: repoRoot,
      encoding: "utf8",
      // prisma.config.ts takes the datasource from DATABASE_URL.
      env: { ...process.env, DATABASE_URL: `file:${databaseFile}` },
    },
  );
}

const scratchDir = mkdtempSync(path.join(tmpdir(), "my-iso-migrations-"));
let exitCode = 0;
try {
  const databaseFile = path.join(scratchDir, "migrated.sqlite");
  const files = listMigrations();

  const database = new Database(databaseFile);
  try {
    for (const name of files) {
      try {
        database.exec(readFileSync(path.join(migrationsDir, name), "utf8"));
      } catch (error) {
        throw new Error(`${name} does not apply: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    database.close();
  }

  if (mode === "diff") {
    const result = prismaDiff(databaseFile, ["--script"]);
    if (result.status !== 0) {
      throw new Error(`prisma migrate diff failed:\n${result.stderr}`);
    }
    process.stdout.write(result.stdout);
  } else {
    // --exit-code: 0 = no difference, 2 = difference, 1 = error.
    const result = prismaDiff(databaseFile, ["--exit-code"]);
    if (result.status === 0) {
      console.log(
        `OK: ${files.length} migration file(s) in migrations/ produce exactly the schema in ${schemaPath}.`,
      );
    } else if (result.status === 2) {
      console.error(
        `migrations/ and ${schemaPath} are out of sync. Applying the migrations does not give the schema:\n`,
      );
      console.error(result.stdout.trim());
      console.error(
        "\nAdd a migration for the change: `npm run db:migrate:diff` prints its SQL (see docs/DATABASE.md).",
      );
      exitCode = 1;
    } else {
      throw new Error(`prisma migrate diff failed:\n${result.stderr || result.stdout}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  rmSync(scratchDir, { force: true, recursive: true });
}
process.exit(exitCode);
