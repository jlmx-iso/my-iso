import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const userRouter = createTRPCRouter({
  addFavorite: protectedProcedure
    .input(z.object({ userId: z.string().min(1), photographerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.favorite.create({
        data: {
          user: {
            connect: { id: input.userId },
          },
          targetId: input.photographerId,
        },
      });
    }),
  
  removeFavorite: protectedProcedure
    .input(z.object({ userId: z.string().min(1), photographerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.favorite.deleteMany({
        where: {
          userId: input.userId,
          targetId: input.photographerId,
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
});