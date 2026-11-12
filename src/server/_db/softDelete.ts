import type { PrismaClient } from "@prisma/client";

/**
 * Soft-delete filtering for every read of a model that has an `isDeleted`
 * column.
 *
 * Rows are hidden from `findMany`, `findFirst(OrThrow)`, `findUnique(OrThrow)`,
 * `count`, `aggregate` and `groupBy` unless the caller's `where` mentions
 * `isDeleted` itself, which is how a query opts in to seeing deleted rows.
 *
 * Not covered, by design of Prisma query extensions: relations loaded through
 * `include`/`select` and relation `_count`s. Those must filter explicitly
 * (`where: { isDeleted: false }`). Writes are not filtered either.
 */

type ReadArgs = { where?: Record<string, unknown> };
type ReadHook = (params: {
  args: ReadArgs;
  query: (args: ReadArgs) => Promise<unknown>;
}) => Promise<unknown>;

export function withSoftDeleteFilter<T extends ReadArgs>(args: T): T {
  const where = args.where ?? {};
  if (Object.prototype.hasOwnProperty.call(where, "isDeleted")) return args;
  return { ...args, where: { ...where, isDeleted: false } };
}

const filterDeleted: ReadHook = ({ args, query }) =>
  query(withSoftDeleteFilter(args));

const softDeleteReads = {
  aggregate: filterDeleted,
  count: filterDeleted,
  findFirst: filterDeleted,
  findFirstOrThrow: filterDeleted,
  findMany: filterDeleted,
  findUnique: filterDeleted,
  findUniqueOrThrow: filterDeleted,
  groupBy: filterDeleted,
};

export function extendWithSoftDelete(client: PrismaClient) {
  return client.$extends({
    query: {
      booking: softDeleteReads,
      comment: softDeleteReads,
      commentLike: softDeleteReads,
      event: softDeleteReads,
      eventLike: softDeleteReads,
      message: softDeleteReads,
      portfolioImage: softDeleteReads,
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof extendWithSoftDelete>;
