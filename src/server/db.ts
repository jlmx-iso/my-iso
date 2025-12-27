import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { env } from "~/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  pool: Pool;
};

// Create connection pool for Prisma v7 adapter
const pool = globalForPrisma.pool ?? new Pool({ connectionString: env.DATABASE_URL });
if (env.NODE_ENV !== "production") globalForPrisma.pool = pool;

// Create adapter for Prisma v7
const adapter = new PrismaPg(pool);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development" ? ["query", "info", "error", "warn"] : ["error"],
  }).$extends({
    query: {
      message: {
        async findMany({ model, operation, args, query }) {
          args.where = { ...args, isDeleted: false };
          return query(args);
        }
      },
    },
  });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
