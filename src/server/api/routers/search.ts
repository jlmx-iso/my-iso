import { z } from "zod";

import { withDerivedFulfilled } from "~/server/_db/bookingTransitions";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createTRPCRouter, protectedProcedure, rateLimit } from "~/server/api/trpc";

export const SEARCH_MAX_LIMIT = 50;
export const SEARCH_MAX_OFFSET = 1000;

const searcherUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  profilePic: true,
} as const;

export const searchRouter = createTRPCRouter({
  /**
   * Member and event search. Signed-in members only: it is the member
   * directory. Pages are bounded (`limit`, `offset`) and ordered by a stable
   * key, so paging neither skips nor repeats rows and cannot be used to pull
   * the whole table in one request.
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

      // Build where clause for photographers
      const photographerWhere = {
        AND: [
          {
            OR: [
              { name: { contains: query } },
              { bio: { contains: query } },
              { companyName: { contains: query } },
            ],
          },
          ...(location ? [{ location: { contains: location } }] : []),
        ],
      };

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

      // Execute queries conditionally for better performance
      // Using Promise.all ensures parallel execution when both are needed
      const photographersPromise = shouldSearchPhotographers
        ? ctx.db.photographer.findMany({
            where: photographerWhere,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: limit,
            skip: offset,
            include: {
              user: { select: searcherUserSelect },
              portfolioImages: {
                where: { isDeleted: false },
                orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
                take: 4,
                select: { id: true, image: true, title: true },
              },
            },
          })
        : Promise.resolve([]);

      const eventsPromise = shouldSearchEvents
        ? ctx.db.event.findMany({
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
          })
        : Promise.resolve([]);

      // Run queries in parallel
      const [photographers, events] = await Promise.all([
        photographersPromise,
        eventsPromise,
      ]);

      return {
        photographers,
        events: await withDerivedFulfilled(ctx.db, events),
      };
    }),
});
