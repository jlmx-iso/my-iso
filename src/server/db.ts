import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type { D1Database } from "@cloudflare/workers-types";

import { env } from "~/env";
import { logger } from "~/_utils";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

/**
 * Get D1 database binding if available (Cloudflare Workers/Pages only)
 */
const getD1Database = (): D1Database | undefined => {
  if (typeof globalThis !== 'undefined' && 'DB' in globalThis) {
    const db = (globalThis as { DB?: unknown }).DB;
    if (
      db &&
      typeof db === 'object' &&
      'prepare' in db &&
      typeof db.prepare === 'function'
    ) {
      return db as D1Database;
    }
  }
  return undefined;
};

/**
 * Create adapter based on environment:
 * - Cloudflare Workers/Pages: D1 adapter
 * - Local file-based SQLite: better-sqlite3 adapter
 * - Remote LibSQL server: LibSQL adapter (libsql://, wss://, https://)
 */
const adapter = (() => {
  const DB = getD1Database();
  if (DB) {
    logger.info('Using D1 adapter for Cloudflare Workers/Pages');
    return new PrismaD1(DB);
  }

  if (env.DATABASE_URL) {
    // file: URLs aren't supported by the LibSQL web client.
    // Use better-sqlite3 for local file-based SQLite instead.
    if (env.DATABASE_URL.startsWith("file:")) {
      logger.info('Using better-sqlite3 adapter for local development');
      return new PrismaBetterSqlite3({ url: env.DATABASE_URL });
    }

    logger.info('Using LibSQL adapter', { url: env.DATABASE_URL });
    return new PrismaLibSql({ url: env.DATABASE_URL });
  }

  throw new Error(
    'No database adapter available. ' +
    'For Cloudflare: Ensure D1 binding is configured in wrangler.toml. ' +
    'For local development: Set DATABASE_URL environment variable.'
  );
})();

const createPrismaClient = () => {
  const client = new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["query", "info", "error", "warn"] : ["error"],
  });

  return client.$extends({
    query: {
      message: {
        async findMany({ args, query }) {
          return query({
            ...args,
            where: {
              ...(args.where ?? {}),
              isDeleted: false,
            },
          });
        },
      },
    },
  });
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
