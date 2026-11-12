import { Prisma } from "@prisma/client";
import { z } from "zod";

import { SEARCH_MAX_LIMIT, SEARCH_MAX_OFFSET } from "~/_utils/limits";
import { proAccessSql, withPro, withProOn } from "~/server/_billing/proStatus";
import { withDerivedFulfilled } from "~/server/_db/bookingTransitions";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createTRPCRouter, protectedProcedure, rateLimit } from "~/server/api/trpc";

// Shared with the search page (~/_utils/limits); re-exported for existing importers.
export { SEARCH_MAX_LIMIT, SEARCH_MAX_OFFSET };

const searcherUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  profilePic: true,
} as const;

/** `%text%` for LIKE, with LIKE's own wildcards in `text` taken literally. */
export function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * One page of photographer ids matching `query` (and `location`), in search
 * order:
 *
 * 1. Relevance tier: the name matches, else the company name, else only the
 *    bio. A better match always comes first.
 * 2. Within a tier, Pro members first: priority placement. Decided at read
 *    time by the entitlement rule in SQL (proAccessSql), so a subscription
 *    that has lapsed stops ranking at that moment; nothing stored can go
 *    stale.
 * 3. Then name, then id: a total order, so paging by offset neither skips
 *    nor repeats anyone.
 *
 * Priority only ORDERS the matches; the WHERE clause (query, location) is
 * the same for everyone, so it never adds a result. Matching is SQLite LIKE
 * (case-insensitive for ASCII), as Prisma's `contains` is.
 */
export async function rankedPhotographerIds(
  db: Pick<ExtendedPrismaClient, "$queryRaw">,
  args: { query: string; location?: string; limit: number; offset: number; now?: Date },
): Promise<string[]> {
  const pattern = likeContains(args.query);
  const like = (column: string, value: string) => Prisma.sql`${Prisma.raw(`p."${column}"`)} LIKE ${value} ESCAPE '\\'`;
  const location = args.location ? Prisma.sql`AND ${like("location", likeContains(args.location))}` : Prisma.empty;

  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p."id" AS "id"
    FROM "Photographer" p
    LEFT JOIN "Subscription" s ON s."userId" = p."userId"
    WHERE NOT p."isDeleted"
      AND (${like("name", pattern)} OR ${like("companyName", pattern)} OR ${like("bio", pattern)})
      ${location}
    ORDER BY
      CASE WHEN ${like("name", pattern)} THEN 0 WHEN ${like("companyName", pattern)} THEN 1 ELSE 2 END,
      CASE WHEN ${proAccessSql("s", args.now ?? new Date())} THEN 0 ELSE 1 END,
      p."name" ASC,
      p."id" ASC
    LIMIT ${args.limit} OFFSET ${args.offset}`);
  return rows.map((row) => row.id);
}

export const searchRouter = createTRPCRouter({
  /**
   * Member and event search. Signed-in members only: it is the member
   * directory. Pages are bounded (`limit`, `offset`) and ordered by a stable
   * key, so paging neither skips nor repeats rows and cannot be used to pull
   * the whole table in one request. Photographers come in the order of
   * rankedPhotographerIds (relevance, then Pro, then name); every person
   * carries `isPro` for the badge.
   */
  searchAll: protectedProcedure
    .use(rateLimit(RateLimits.MEMBER_SEARCH))
    .input(z.object({
      query: z.string().trim().min(1).max(100),
      location: z.string().trim().max(200).optional(),
      filters: z.object({
        type: z.enum(['photographers', 'events', 'all']).default('all'),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      }).optional(),
      limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).default(20),
      offset: z.number().int().min(0).max(SEARCH_MAX_OFFSET).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const { query, location, filters, limit, offset } = input;

      // Build where clause for events (deleted events are excluded by the
      // soft-delete extension on findMany)
      const eventWhere = {
        AND: [
          {
            OR: [
              { title: { contains: query } },
              { description: { contains: query } },
            ],
          },
          ...(location ? [{ location: { contains: location } }] : []),
          ...(filters?.dateFrom && filters?.dateTo
            ? [{
                date: {
                  gte: filters.dateFrom,
                  lte: filters.dateTo,
                },
              }]
            : []),
        ],
      };

      // Determine if we should search each type
      const shouldSearchPhotographers = !filters?.type || filters.type === 'all' || filters.type === 'photographers';
      const shouldSearchEvents = !filters?.type || filters.type === 'all' || filters.type === 'events';

      const findPhotographers = async () => {
        // The order is decided in SQL; the page (at most SEARCH_MAX_LIMIT
        // ids, under D1's bound-parameter limit) is then loaded with its
        // relations and put back in that order.
        const ids = await rankedPhotographerIds(ctx.db, { limit, location, offset, query });
        if (ids.length === 0) return [];
        const rows = await ctx.db.photographer.findMany({
          where: { id: { in: ids } },
          include: {
            user: { select: searcherUserSelect },
            portfolioImages: {
              where: { isDeleted: false },
              orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
              take: 4,
              select: { id: true, image: true, title: true },
            },
          },
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const ordered = ids.flatMap((id) => byId.get(id) ?? []);
        return withPro(ctx.db, ordered, (row) => row.userId);
      };

      const findEvents = async () => {
        const events = await ctx.db.event.findMany({
          where: eventWhere,
          orderBy: [{ date: 'asc' }, { id: 'asc' }],
          take: limit,
          skip: offset,
          include: {
            photographer: {
              include: {
                user: { select: searcherUserSelect },
              },
            },
            _count: {
              select: {
                // Relation counts are not covered by the soft-delete
                // extension, so deleted rows are excluded here.
                comments: { where: { isDeleted: false } },
                eventLikes: { where: { isDeleted: false } },
              },
            },
          },
        });
        return withProOn(ctx.db, await withDerivedFulfilled(ctx.db, events), "photographer", (owner) => owner.userId);
      };

      // Run queries in parallel
      const [photographers, events] = await Promise.all([
        shouldSearchPhotographers ? findPhotographers() : Promise.resolve([]),
        shouldSearchEvents ? findEvents() : Promise.resolve([]),
      ]);

      return { photographers, events };
    }),
});
