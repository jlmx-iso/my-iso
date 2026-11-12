import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  baselineSchema,
  BASELINE_MIGRATION,
  compareSchemas,
  DUPLICATE_COUNTS_SQL,
  migrationFiles,
  MIGRATIONS_DIR,
  PRE_BASELINE_SCHEMA_FILE,
  REPO_ROOT,
  schemaOfDatabase,
  schemaOfSql,
  UPGRADE_FILE,
} from "../../../scripts/lib/legacyDb.mjs";

/**
 * migrations/legacy/upgrade-pre-baseline.sql against what the staging and
 * production D1 databases are: main's schema at 2d1d630 (the pre-baseline
 * schema), staging with that commit's seed, plus the kinds of rows the
 * upgrade has to clean up.
 */

const SEED = path.join(REPO_ROOT, "src/test/fixtures/pre-baseline-seed-staging.sql");
const read = (file: string) => readFileSync(file, "utf8");

/** Tables the seed fills, and one row of each it must keep (id → a column it must still hold). */
const SEEDED_SAMPLES = {
  Comment: { column: "eventId", id: "seed_c1" },
  Event: { column: "photographerId", id: "seed_e1" },
  Favorite: { column: "userId", id: "seed_f1" },
  InviteCode: { column: "code", id: "seed_inv1" },
  Photographer: { column: "userId", id: "seed_p1" },
  User: { column: "email", id: "seed_u1" },
  Waitlist: { column: "email", id: "seed_w1" },
} as const;

/** Rows added on purpose: each clashes with a unique index the baseline adds. */
const DUPLICATES = `
INSERT INTO "EventLike" (id, createdAt, updatedAt, eventId, userId, isDeleted) VALUES
  ('el_old_deleted', '2026-03-01T09:00:00.000Z', '2026-03-01T09:00:00.000Z', 'seed_e1', 'seed_u2', 1),
  ('el_live',        '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z', 'seed_e1', 'seed_u2', 0),
  ('el_other',       '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z', 'seed_e2', 'seed_u2', 0);
-- Same pair, both live. The first is LATER in time but written in SQLite's
-- CURRENT_TIMESTAMP form, which sorts before any ISO 'T' form as text: only
-- normalising timestamps first makes "keep the oldest" keep cl_older.
INSERT INTO "CommentLike" (id, createdAt, updatedAt, commentId, userId, isDeleted) VALUES
  ('cl_newer', '2026-03-01 11:00:00', '2026-03-01 11:00:00', 'seed_c1', 'seed_u3', 0),
  ('cl_older', '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z', 'seed_c1', 'seed_u3', 0);
INSERT INTO "Review" (id, createdAt, updatedAt, photographerId, userId, rating, title) VALUES
  ('rv_first',  '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z', 'seed_p1', 'seed_u4', 3, 'OK'),
  ('rv_edited', '2026-03-01T10:00:00.000Z', '2026-03-05T10:00:00.000Z', 'seed_p1', 'seed_u4', 5, 'Great');
INSERT INTO "InviteRedemption" (id, inviteCodeId, redeemedById, redeemedAt) VALUES
  ('ir_first',  'seed_inv1', 'seed_u5', '2026-03-01T10:00:00.000Z'),
  ('ir_second', 'seed_inv2', 'seed_u5', '2026-03-02T10:00:00.000Z');
INSERT INTO "VerificationToken" (identifier, token, expires) VALUES
  ('pending@example.com', '123456', '2099-01-01T00:00:00.000Z');
`;

/** Rows each deliberate duplicate group loses. */
const REMOVED = { CommentLike: 1, EventLike: 1, InviteRedemption: 1, Review: 1, VerificationToken: 1 } as const;
const ADDED = { CommentLike: 2, EventLike: 3, InviteRedemption: 2, Review: 2, VerificationToken: 1 } as const;

/** wrangler 4's own CREATE TABLE for its migrations table (getCreateMigrationsTableQuery). */
const WRANGLER_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

let db: Database.Database;

function appTables(): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function rowCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of appTables()) {
    counts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
  }
  return counts;
}

function ids(table: string): string[] {
  return (db.prepare(`SELECT id FROM "${table}" ORDER BY id`).all() as { id: string }[]).map((row) => row.id);
}

/** Every DATETIME column of every app table, as [table, column]. */
function datetimeColumns(): [string, string][] {
  return appTables().flatMap((table) =>
    (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string }[])
      .filter((column) => /DATETIME/i.test(column.type))
      .map((column): [string, string] => [table, column.name]),
  );
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(read(PRE_BASELINE_SCHEMA_FILE));
  db.exec(read(SEED));
  db.exec(DUPLICATES);
});

afterEach(() => {
  db.close();
});

describe("migrations/legacy", () => {
  it("is not a directory wrangler applies: only migrations/*.sql are migrations", () => {
    expect(path.dirname(UPGRADE_FILE)).not.toBe(MIGRATIONS_DIR);
    expect(migrationFiles()).not.toContain(path.basename(UPGRADE_FILE));
    expect(migrationFiles()[0]).toBe(BASELINE_MIGRATION);
  });

  it("the fixture holds the pre-baseline schema and the old staging seed loads into it", () => {
    expect(rowCounts()).toMatchObject({ Event: 30, InviteCode: 10, User: 10, Waitlist: 3 });
    // The upgrade's preview query runs on it and finds every deliberate duplicate.
    const preview = db.prepare(DUPLICATE_COUNTS_SQL).all() as { duplicatedGroups: number }[];
    expect(preview.map((row) => row.duplicatedGroups)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("upgrade-pre-baseline.sql", () => {
  it("brings the database to exactly the baseline, and records it as wrangler would", () => {
    db.exec(read(UPGRADE_FILE));

    const difference = compareSchemas(schemaOfDatabase(db), baselineSchema());
    expect(difference).toEqual({ equal: true, missing: [], unexpected: [] });

    const recorded = db.prepare("SELECT name FROM d1_migrations").all();
    expect(recorded).toEqual([{ name: BASELINE_MIGRATION }]);
    const table = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'd1_migrations'").get() as { sql: string };
    // wrangler creates the table with IF NOT EXISTS; SQLite stores it without.
    expect(table.sql).toBe(WRANGLER_MIGRATIONS_TABLE.replace("IF NOT EXISTS ", ""));
  });

  it("then takes the remaining migrations to exactly the full chain", () => {
    db.exec(read(UPGRADE_FILE));
    for (const file of migrationFiles().filter((name) => name !== BASELINE_MIGRATION)) {
      db.exec(read(path.join(MIGRATIONS_DIR, file)));
    }
    const fullChain = schemaOfSql(migrationFiles().map((file) => read(path.join(MIGRATIONS_DIR, file))));
    expect(compareSchemas(schemaOfDatabase(db), fullChain)).toEqual({ equal: true, missing: [], unexpected: [] });
  });

  it("keeps all seed data and removes only the deliberate duplicates", () => {
    const before = rowCounts();
    db.exec(read(UPGRADE_FILE));
    const after = rowCounts();

    for (const [table, count] of Object.entries(before)) {
      const removed = REMOVED[table as keyof typeof REMOVED] ?? 0;
      expect({ count: after[table], table }).toEqual({ count: count - removed, table });
    }
    expect(after.RateLimit).toBe(0);

    for (const [table, { column, id }] of Object.entries(SEEDED_SAMPLES)) {
      const row = db.prepare(`SELECT "${column}" AS value FROM "${table}" WHERE id = ?`).get(id) as
        | { value: unknown }
        | undefined;
      expect({ table, value: row?.value }).toEqual({ table, value: expect.anything() });
    }
    const sarah = db.prepare(`SELECT email, handle, role, createdAt FROM "User" WHERE id = 'seed_u1'`).get();
    expect(sarah).toEqual({
      createdAt: "2026-02-24T12:00:00.000+00:00",
      email: "sarah@example.com",
      handle: "sarahchen",
      role: "founding_member",
    });
    // Sanity for the arithmetic above: what was added on purpose.
    for (const [table, added] of Object.entries(ADDED)) {
      expect(before[table]).toBeGreaterThanOrEqual(added);
    }
  });

  it("keeps the documented row of each duplicate group", () => {
    db.exec(read(UPGRADE_FILE));
    expect(ids("EventLike")).toEqual(["el_live", "el_other"]); // a live one over a deleted one
    expect(ids("CommentLike")).toEqual(["cl_older"]); // the oldest, by time, not by spelling
    expect(ids("Review")).toEqual(["rv_edited"]); // the most recently edited
    expect(ids("InviteRedemption")).toEqual(["ir_first"]); // the first
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "VerificationToken"`).get()).toEqual({ n: 0 });
  });

  it("leaves every timestamp in Prisma's one spelling", () => {
    db.exec(read(UPGRADE_FILE));
    const columns = datetimeColumns();
    expect(columns.length).toBeGreaterThan(40);
    for (const [table, column] of columns) {
      const off = db
        .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE typeof("${column}") = 'text' AND "${column}" NOT LIKE '____-__-__T__:__:__.___+00:00'`)
        .get() as { n: number };
      expect({ column: `${table}.${column}`, off: off.n }).toEqual({ column: `${table}.${column}`, off: 0 });
    }
    // Normalised, not shifted.
    const event = db.prepare(`SELECT date FROM "Event" WHERE id = 'seed_e1'`).get() as { date: string };
    const seeded = (/'seed_e1'(?:, '[^']*'){6}, '([^']+)'/.exec(read(SEED)))?.[1];
    expect(seeded).toMatch(/Z$/);
    expect(new Date(event.date).getTime()).toBe(new Date(seeded ?? "").getTime());
  });

  it("normalises every DATETIME column of the baseline (none forgotten)", () => {
    db.exec(read(UPGRADE_FILE));
    const upgrade = read(UPGRADE_FILE);
    const covered = new Set(
      [...upgrade.matchAll(/^UPDATE "(\w+)" SET "(\w+)" = strftime/gm)].map((match) => `${match[1]}.${match[2]}`),
    );
    // VerificationToken is emptied instead.
    const expected = datetimeColumns()
      .map(([table, column]) => `${table}.${column}`)
      .filter((name) => !name.startsWith("VerificationToken."));
    expect([...covered].sort()).toEqual(expected.sort());
  });

  it("refuses to run twice: the baseline row is unique", () => {
    db.exec(read(UPGRADE_FILE));
    expect(() => db.exec(read(UPGRADE_FILE))).toThrow();
  });
});

describe('docs/DATABASE.md, "Timestamps are text: one spelling"', () => {
  it("its normalisation runs cleanly on the old staging data", () => {
    const doc = read(path.join(REPO_ROOT, "docs/DATABASE.md"));
    const block = (/```sql\n\s*(UPDATE "Event" SET "date"[\s\S]*?)```/.exec(doc))?.[1];
    expect(block).toBeDefined();
    db.exec(block ?? "");
    const left = db.prepare(`SELECT COUNT(*) AS n FROM "Event" WHERE "date" LIKE '%Z' OR "createdAt" LIKE '%Z' OR "updatedAt" LIKE '%Z'`).get();
    expect(left).toEqual({ n: 0 });
  });
});
