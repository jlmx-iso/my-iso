import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import type { D1Database } from "@cloudflare/workers-types";

import { env } from "~/env";
import { logger } from "~/_utils";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createExtendedClient>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createExtendedClient(adapter: any) {
  const client = new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development"
        ? ["query", "info", "error", "warn"]
        : ["error"],
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
}

type ExtendedClient = ReturnType<typeof createExtendedClient>;

let cachedClient: ExtendedClient | null = globalForPrisma.prisma ?? null;

// Detect Cloudflare Workers: OpenNext defines this Symbol property on globalThis
// at startup (before any module code). The .env file's DATABASE_URL gets baked
// into next-env.mjs during build, so we can't rely on DATABASE_URL being absent
// in Cloudflare — we must explicitly detect the runtime.
const isCloudflareWorker =
  Symbol.for("__cloudflare-context__") in
  (globalThis as Record<symbol, unknown>);

/**
 * Eagerly initialize for local development only.
 * In Cloudflare Workers, D1 is used via lazy initialization (see getDb below).
 */
if (!cachedClient && !isCloudflareWorker && env.DATABASE_URL) {
  if (env.DATABASE_URL.startsWith("file:")) {
    logger.info("Using better-sqlite3 adapter for local development");
    const { PrismaBetterSqlite3 } = await import(
      /* webpackIgnore: true */ "@prisma/adapter-better-sqlite3"
    );
    cachedClient = createExtendedClient(
      new PrismaBetterSqlite3({ url: env.DATABASE_URL }),
    );
  } else {
    logger.info("Using LibSQL adapter", { url: env.DATABASE_URL });
    const { PrismaLibSql } = await import(
      /* webpackIgnore: true */ "@prisma/adapter-libsql"
    );
    cachedClient = createExtendedClient(
      new PrismaLibSql({ url: env.DATABASE_URL }),
    );
  }

  if (env.NODE_ENV !== "production") {
    globalForPrisma.prisma = cachedClient;
  }
}

/**
 * Get or create the database client.
 * - Local dev: returns the eagerly-initialized client (set above)
 * - Cloudflare Workers: lazily creates client using D1 from getCloudflareContext()
 */
function getDb(): ExtendedClient {
  if (cachedClient) return cachedClient;

  // Cloudflare Workers: D1 bindings are only available during request
  // handling via AsyncLocalStorage, not at module load time. OpenNext
  // stores the request context at a well-known Symbol on globalThis.
  try {
    const cfCtx = (globalThis as Record<symbol, unknown>)[
      Symbol.for("__cloudflare-context__")
    ] as { env?: Record<string, unknown> } | undefined;
    const d1 = cfCtx?.env?.DB as D1Database | undefined;
    if (d1) {
      logger.info("Using D1 adapter for Cloudflare Workers/Pages");
      cachedClient = createExtendedClient(new PrismaD1(d1));
      return cachedClient;
    }
  } catch {
    // Not in Cloudflare context
  }

  throw new Error(
    "No database adapter available. " +
      "For Cloudflare: Ensure D1 binding is configured in wrangler.toml. " +
      "For local development: Set DATABASE_URL environment variable.",
  );
}

/**
 * Proxied database client for lazy initialization in Cloudflare Workers.
 *
 * In local dev, the client is eagerly initialized via top-level await above.
 * In Cloudflare, D1 bindings are only available during request handling
 * (via getCloudflareContext), so the client is lazily created on first access.
 */
export const db: ExtendedClient = new Proxy({} as ExtendedClient, {
  get(_, prop) {
    // Prevent Proxy from being treated as a thenable
    if (prop === "then") return undefined;
    const client = getDb();
    return (client as Record<string | symbol, unknown>)[prop];
  },
});
