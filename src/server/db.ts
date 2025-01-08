import { PrismaClient } from "@prisma/client";

import { env } from "~/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
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
