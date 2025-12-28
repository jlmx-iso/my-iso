import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import type { Prisma } from "@prisma/client";

// Define the return types for our queries
type PhotographerWithUser = Prisma.PhotographerGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
        profilePic: true;
      };
    };
  };
}>;

type EventWithDetails = Prisma.EventGetPayload<{
  include: {
    photographer: {
      include: {
        user: {
          select: {
            id: true;
            firstName: true;
            lastName: true;
          };
        };
      };
    };
    _count: {
      select: {
        comments: true;
        eventLikes: true;
      };
    };
  };
}>;

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

      const results: {
        photographers: PhotographerWithUser[];
        events: EventWithDetails[];
      } = {
        photographers: [],
        events: [],
      };

      // Search photographers
      if (!filters?.type || filters.type === 'all' || filters.type === 'photographers') {
        results.photographers = await ctx.db.photographer.findMany({
          where: {
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
          },
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
          },
        });
      }

      // Search events
      if (!filters?.type || filters.type === 'all' || filters.type === 'events') {
        results.events = await ctx.db.event.findMany({
          where: {
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
          },
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
        });
      }

      return results;
    }),
});
