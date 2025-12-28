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
              { name: { contains: query, mode: 'insensitive' } },
              { bio: { contains: query, mode: 'insensitive' } },
              { companyName: { contains: query, mode: 'insensitive' } },
            ],
          },
          ...(location ? [{ location: { contains: location, mode: 'insensitive' } }] : []),
        ],
      };

      // Build where clause for events
      const eventWhere = {
        AND: [
          { isDeleted: false },
          {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
            ],
          },
          ...(location ? [{ location: { contains: location, mode: 'insensitive' } }] : []),
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

      // Run queries in parallel (use take: 0 to skip query without changing return type)
      const [photographers, events] = await Promise.all([
        ctx.db.photographer.findMany({
          where: photographerWhere,
          take: shouldSearchPhotographers ? limit : 0,
          skip: shouldSearchPhotographers ? offset : 0,
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
        }),

        ctx.db.event.findMany({
          where: eventWhere,
          take: shouldSearchEvents ? limit : 0,
          skip: shouldSearchEvents ? offset : 0,
          include: {
            photographer: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
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
        }),
      ]);

      return {
        photographers,
        events,
      };
    }),
});
