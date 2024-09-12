import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const userRouter = createTRPCRouter({
  addFavorite: protectedProcedure
    .input(z.object({ photographerId: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.favorite.create({
        data: {
          targetId: input.photographerId,
          user: {
            connect: { id: input.userId },
          },
        },
      });
    }),
  
  getFavorites: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.favorite.findMany({
        where: {
          userId: input.userId,
        },
      });
    }),
  
  removeFavorite: protectedProcedure
    .input(z.object({ photographerId: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.favorite.deleteMany({
        where: {
          targetId: input.photographerId,
          userId: input.userId,
        },
      });
    }),
});