import { describe, expect, it } from "vitest";

import {
  backupPath,
  baselineSchema,
  bookmarkPath,
  classifyDatabase,
  compareSchemas,
  describeDifference,
  normaliseSql,
  parseBookmark,
  parseUpgradeArgs,
  parseWranglerJson,
  preBaselineSchema,
  restoreCommand,
  schemaOfSql,
  WRANGLER_ENV_ARGS,
} from "./legacyDb.mjs";

describe("parseUpgradeArgs", () => {
  it("takes the environment in either spelling, and --yes", () => {
    expect(parseUpgradeArgs(["--env", "staging"])).toEqual({ env: "staging", yes: false });
    expect(parseUpgradeArgs(["--env=production", "--yes"])).toEqual({ env: "production", yes: true });
    expect(parseUpgradeArgs(["--yes", "--env", "staging"])).toEqual({ env: "staging", yes: true });
  });

  it.each([
    [[]],
    [["--env"]],
    [["--env", "prod"]],
    [["--env="]],
    [["staging"]],
    [["--env", "staging", "--force"]],
    [["--env", "staging", "-y"]],
  ])("refuses %j with the usage line", (argv) => {
    expect(() => parseUpgradeArgs(argv)).toThrow(/Usage: npm run db:upgrade-legacy -- --env <staging\|production>/);
  });

  it("maps each environment to wrangler's flags (production is the top level)", () => {
    expect(WRANGLER_ENV_ARGS.staging).toEqual(["--env", "staging"]);
    expect(WRANGLER_ENV_ARGS.production).toEqual(["--env="]);
  });
});

describe("backupPath", () => {
  it("is under backups/, named by environment and time, without colons", () => {
    expect(backupPath("staging", new Date("2026-11-12T09:08:07.006Z"))).toBe(
      "backups/staging-2026-11-12T09-08-07-006Z.sql",
    );
  });
});

describe("Time Travel bookmark", () => {
  it("is saved next to the backup", () => {
    expect(bookmarkPath("backups/staging-2026-11-12T09-08-07-006Z.sql")).toBe(
      "backups/staging-2026-11-12T09-08-07-006Z.bookmark",
    );
  });

  it("is read from `wrangler d1 time-travel info --json`, past any log lines", () => {
    const json = JSON.stringify({ bookmark: "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683" }, null, 2);
    expect(parseBookmark(json)).toBe("00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683");
    expect(parseBookmark(`Some notice\n${json}`)).toBe("00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683");
  });

  it("refuses output without a usable bookmark: no upgrade without a way back", () => {
    expect(() => parseBookmark("Time Traveling...")).toThrow(/No JSON/);
    expect(() => parseBookmark("{}")).toThrow(/No bookmark/);
    expect(() => parseBookmark('{"bookmark": ""}')).toThrow(/No bookmark/);
    expect(() => parseBookmark('{"bookmark": "a b; rm -rf"}')).toThrow(/No bookmark/);
  });

  it("gives the restore command wrangler documents, per environment", () => {
    expect(restoreCommand("staging", "abc-123")).toBe(
      "npx wrangler d1 time-travel restore DB --bookmark=abc-123 --env staging",
    );
    expect(restoreCommand("production", "abc-123")).toBe(
      "npx wrangler d1 time-travel restore DB --bookmark=abc-123 --env=",
    );
  });
});

describe("classifyDatabase", () => {
  it("tells the three states apart", () => {
    expect(classifyDatabase({ baselineApplied: false, tables: [] })).toBe("empty");
    expect(classifyDatabase({ baselineApplied: false, tables: ["d1_migrations"] })).toBe("empty");
    expect(classifyDatabase({ baselineApplied: false, tables: ["User"] })).toBe("pre-baseline");
    expect(classifyDatabase({ baselineApplied: false, tables: ["User", "d1_migrations"] })).toBe("pre-baseline");
    expect(classifyDatabase({ baselineApplied: true, tables: ["User", "d1_migrations"] })).toBe("migrated");
  });
});

describe("parseWranglerJson", () => {
  it("returns the first result's rows, past any log lines", () => {
    const out = `Executing on remote database DB:\n[{"results":[{"name":"User"}],"success":true,"meta":{}}]`;
    expect(parseWranglerJson(out)).toEqual([{ name: "User" }]);
  });

  it("refuses a failure or anything else", () => {
    expect(() => parseWranglerJson("no json here")).toThrow(/No JSON/);
    expect(() => parseWranglerJson("[]")).toThrow(/Unexpected/);
    expect(() => parseWranglerJson('[{"results":[],"success":false}]')).toThrow(/failure/);
  });
});

describe("schema comparison", () => {
  it("ignores layout, including what ALTER TABLE ADD COLUMN leaves in the stored text", () => {
    expect(normaliseSql('CREATE TABLE "A" (\n  "x" TEXT NOT NULL\n, "y" INTEGER)')).toBe(
      normaliseSql('CREATE TABLE "A" ("x" TEXT NOT NULL, "y" INTEGER)'),
    );
    const altered = schemaOfSql(['CREATE TABLE "A" ("x" TEXT NOT NULL);', 'ALTER TABLE "A" ADD COLUMN "y" INTEGER;']);
    const created = schemaOfSql(['CREATE TABLE "A" (\n    "x" TEXT NOT NULL,\n    "y" INTEGER\n);']);
    expect(compareSchemas(altered, created).equal).toBe(true);
  });

  it("sees a different column, index or table", () => {
    const base = schemaOfSql(['CREATE TABLE "A" ("x" TEXT); CREATE INDEX "A_x" ON "A"("x");']);
    for (const other of [
      'CREATE TABLE "A" ("x" TEXT NOT NULL); CREATE INDEX "A_x" ON "A"("x");',
      'CREATE TABLE "A" ("x" TEXT); CREATE UNIQUE INDEX "A_x" ON "A"("x");',
      'CREATE TABLE "A" ("x" TEXT); CREATE INDEX "A_x" ON "A"("x"); CREATE TABLE "B" ("y" TEXT);',
    ]) {
      expect(compareSchemas(schemaOfSql([other]), base).equal).toBe(false);
    }
    const difference = compareSchemas(schemaOfSql(['CREATE TABLE "B" ("y" TEXT);']), base);
    expect(describeDifference(difference)).toContain('missing:    index A_x ON A: CREATE INDEX "A_x" ON "A"("x")');
    expect(describeDifference(difference)).toContain("unexpected: table B ON B");
  });

  it("ignores wrangler's and D1's own tables, and replays a D1 export", () => {
    const exported = [
      "PRAGMA defer_foreign_keys=TRUE;",
      'CREATE TABLE "A" ("x" TEXT);',
      "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);",
      "CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID;",
      'DELETE FROM sqlite_sequence;',
      'INSERT INTO "sqlite_sequence" VALUES(\'d1_migrations\',1);',
    ].join("\n");
    expect(compareSchemas(schemaOfSql([exported]), schemaOfSql(['CREATE TABLE "A" ("x" TEXT);'])).equal).toBe(true);
  });

  it("tells the pre-baseline schema from the baseline", () => {
    const difference = compareSchemas(preBaselineSchema(), baselineSchema());
    expect(difference.equal).toBe(false);
    expect(difference.missing.join("\n")).toContain("RateLimit");
    expect(difference.unexpected.join("\n")).toContain("VerificationToken_token_key");
  });
});
