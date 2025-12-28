import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const searchRouter = createTRPCRouter({
  searchAll: publicProcedure
    .input(z.object({
      query: z.string().min(1),
      location: z.string().optional(),
      radius: z.number().optional(), // miles
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

      const results = {
        photographers: [] as any[],
        events: [] as any[],
      };

      // Search photographers
      if (!filters?.type || filters.type === 'all' || filters.type === 'photographers') {
        results.photographers = await ctx.db.photographer.findMany({
          where: {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { bio: { contains: query, mode: 'insensitive' } },
              { companyName: { contains: query, mode: 'insensitive' } },
              { location: location ? { contains: location, mode: 'insensitive' } : undefined },
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
        const dateFilter = filters?.dateFrom && filters?.dateTo ? {
          date: {
            gte: filters.dateFrom,
            lte: filters.dateTo,
          },
        } : {};

        results.events = await ctx.db.event.findMany({
          where: {
            isDeleted: false,
            ...dateFilter,
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { location: location ? { contains: location, mode: 'insensitive' } : undefined },
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
