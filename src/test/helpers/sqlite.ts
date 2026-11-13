import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { type Prisma, PrismaClient } from "@prisma/client";
import type { SqlDriverAdapterFactory } from "@prisma/client/runtime/client";
import Database from "better-sqlite3";

import {
  extendWithSoftDelete,
  type ExtendedPrismaClient,
} from "~/server/_db/softDelete";

const repoRoot = path.resolve(__dirname, "../../..");

let schemaSql: string | undefined;

/**
 * DDL of the database, exactly as D1 gets it: every file in migrations/, in
 * the order `wrangler d1 migrations apply` runs them. `npm run db:check`
 * guarantees this is the schema in prisma/schema.prisma.
 */
function getSchemaSql(): string {
  if (schemaSql === undefined) {
    const migrationsDir = path.join(repoRoot, "migrations");
    schemaSql = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");
  }
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
export async function createTestDb(
  options: Pick<Prisma.PrismaClientOptions, "errorFormat"> & {
    /**
     * Behave like Cloudflare D1 where Prisma can tell (the connection
     * reports D1's bind-value limit and no relation joins, so Prisma builds
     * the statements it would build for D1), and report every statement
     * with its number of bound parameters.
     */
    d1?: { onStatement: (statement: { params: number; sql: string }) => void };
  } = {},
): Promise<TestDb> {
  const dir = mkdtempSync(path.join(tmpdir(), "my-iso-test-"));
  const file = path.join(dir, "test.sqlite");

  const bootstrap = new Database(file);
  bootstrap.exec(getSchemaSql());
  bootstrap.close();

  const { d1, ...clientOptions } = options;
  const sqlite = new PrismaBetterSqlite3({ url: `file:${file}` });
  const raw = new PrismaClient({
    adapter: d1 ? asD1(sqlite, d1.onStatement) : sqlite,
    ...clientOptions,
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

/** What @prisma/adapter-d1 reports about a D1 connection. */
export const D1_CONNECTION_INFO = { maxBindValues: 98, supportsRelationJoins: false } as const;

type SqlQuery = Parameters<Awaited<ReturnType<SqlDriverAdapterFactory["connect"]>>["queryRaw"]>[0];

/** Wraps a driver adapter (or one of its transactions) so every statement is reported. */
function recordStatements<T extends object>(
  queryable: T,
  onStatement: (statement: { params: number; sql: string }) => void,
): T {
  return new Proxy(queryable, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (prop === "getConnectionInfo") return () => D1_CONNECTION_INFO;
      if (typeof value !== "function") return value;
      if (prop === "queryRaw" || prop === "executeRaw") {
        return (query: SqlQuery) => {
          onStatement({ params: query.args.length, sql: query.sql });
          return Reflect.apply(value, target, [query]) as unknown;
        };
      }
      if (prop === "startTransaction") {
        return async (...args: unknown[]) =>
          recordStatements((await Reflect.apply(value, target, args)) as object, onStatement);
      }
      return (...args: unknown[]) => Reflect.apply(value, target, args) as unknown;
    },
  });
}

function asD1(
  factory: SqlDriverAdapterFactory,
  onStatement: (statement: { params: number; sql: string }) => void,
): SqlDriverAdapterFactory {
  return {
    adapterName: factory.adapterName,
    connect: async () => recordStatements(await factory.connect(), onStatement),
    provider: factory.provider,
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
