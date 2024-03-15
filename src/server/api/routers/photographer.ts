import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";

export const photographerRouter = createTRPCRouter({
  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findFirst({
        where: { id: input.id },
      });
    }),
  
  getByUsername: publicProcedure
    .input(z.object({ username: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findFirst({
        where: { name: input.username },
      });
    }),
  
  create: protectedProcedure
    .input(z.object({
      userId: z.string().min(1),
      name: z.string().min(1),
      companyName: z.string().min(1),
      location: z.string().min(1),
      avatar: z.string().min(1).optional(),
      bio: z.string().min(1),
      website: z.string().min(1).optional(),
      instagram: z.string().min(1).optional(),
      facebook: z.string().min(1).optional(),
      twitter: z.string().min(1).optional(),
      youtube: z.string().min(1).optional(),
      tiktok: z.string().min(1).optional(),
      vimeo: z.string().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {

      return ctx.db.photographer.create({
        data: input,
      });
    }),
  
  search: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findMany({
        where: {
          OR: [
            { name: { contains: input.query, mode: "insensitive" } },
            { companyName: { contains: input.query, mode: "insensitive" } },
            { location: { contains: input.query, mode: "insensitive" } },
          ],
        },
      });
    }),
});