import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import Database from "better-sqlite3";

import {
  extendWithSoftDelete,
  type ExtendedPrismaClient,
} from "~/server/_db/softDelete";

const repoRoot = path.resolve(__dirname, "../../..");

let schemaSql: string | undefined;

/** DDL for the current Prisma schema, exactly as a fresh D1 would get it. */
function getSchemaSql(): string {
  schemaSql ??= execFileSync(
    path.join(repoRoot, "node_modules/.bin/prisma"),
    [
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      "prisma/schema.prisma",
      "--script",
    ],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return schemaSql;
}

export type TestDb = {
  /** The client the app uses: Prisma + the soft-delete extension. */
  db: ExtendedPrismaClient;
  /** The same database without the soft-delete extension. */
  raw: PrismaClient;
  close: () => Promise<void>;
};

/**
 * Creates a real, empty SQLite database with the app's schema in a temporary
 * directory. Call `close()` when done.
 */
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(path.join(tmpdir(), "my-iso-test-"));
  const file = path.join(dir, "test.sqlite");

  const bootstrap = new Database(file);
  bootstrap.exec(getSchemaSql());
  bootstrap.close();

  const raw = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${file}` }),
  });

  return {
    close: async () => {
      await raw.$disconnect();
      rmSync(dir, { force: true, recursive: true });
    },
    db: extendWithSoftDelete(raw),
    raw,
  };
}

let userCounter = 0;

/** Inserts a user with unique placeholder details. */
export async function createTestUser(
  db: TestDb["db"],
  overrides: Partial<{
    email: string;
    firstName: string;
    lastName: string;
    isDiscoverable: boolean;
    role: string;
  }> = {},
) {
  userCounter += 1;
  return db.user.create({
    data: {
      email: `user${userCounter}-${Date.now()}@example.com`,
      firstName: `First${userCounter}`,
      lastName: `Last${userCounter}`,
      ...overrides,
    },
  });
}
