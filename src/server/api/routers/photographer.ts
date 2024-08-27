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

  getByUserId: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findFirst({
        where: { userId: input.userId },
      });
    }),

  getByUsername: publicProcedure
    .input(z.object({ username: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.photographer.findFirst({
        where: {
          user: {
            handle: input.username,
          }
        },
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
      website: z.string().min(1).nullable(),
      instagram: z.string().min(1).nullable(),
      facebook: z.string().min(1).nullable(),
      twitter: z.string().min(1).nullable(),
      youtube: z.string().min(1).nullable(),
      tiktok: z.string().min(1).nullable(),
      vimeo: z.string().min(1).nullable(),
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

  update: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      companyName: z.string().min(1),
      location: z.string().min(1),
      avatar: z.string().min(1).optional(),
      bio: z.string().min(1).max(1000).nullable(),
      website: z.string().min(1).nullable(),
      instagram: z.string().min(1).nullable(),
      facebook: z.string().min(1).nullable(),
      twitter: z.string().min(1).nullable(),
      youtube: z.string().min(1).nullable(),
      tiktok: z.string().min(1).nullable(),
      vimeo: z.string().min(1).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.photographer.update({
        where: { id: input.id, userId: ctx.session?.user.id },
        data: input,
      }).catch((error) => {
        throw new Error("Failed to update profile");
      });
    }),
});