import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import type { Prisma } from "@prisma/client";

// Define explicit select/include args for type inference
const photographerArgs = {
  include: {
    user: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        profilePic: true,
      },
    },
    portfolioImages: {
      where: { isDeleted: false },
      orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
      take: 4,
      select: { id: true, image: true, title: true },
    },
  },
} satisfies Prisma.PhotographerFindManyArgs;

const eventArgs = {
  include: {
    photographer: {
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePic: true,
          },
        },
      },
    },
    _count: {
      select: {
        comments: true,
        eventLikes: true,
      },
    },
  },
} satisfies Prisma.EventFindManyArgs;

export const searchRouter = createTRPCRouter({
  searchAll: publicProcedure
    .input(z.object({
      query: z.string().min(1),
      location: z.string().optional(),
      filters: z.object({
        type: z.enum(['photographers', 'events', 'all']).default('all'),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      }).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().default(0),
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

      // Build where clause for events
      const eventWhere = {
        AND: [
          { isDeleted: false },
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
            take: limit,
            skip: offset,
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  profilePic: true,
                },
              },
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
            take: limit,
            skip: offset,
            include: {
              photographer: {
                include: {
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      profilePic: true,
                    },
                  },
                },
              },
              _count: {
                select: {
                  comments: true,
                  eventLikes: true,
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
        events,
      };
    }),
});
