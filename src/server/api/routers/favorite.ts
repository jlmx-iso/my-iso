import { z } from "zod";
import { createTRPCRouter, protectedProcedure, } from "~/server/api/trpc";

export const favoriteRouter = createTRPCRouter({
  getByUserId: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.favorite.findMany({
        where: { userId: input.userId },
      });
    }),
  
  create: protectedProcedure
    .input(z.object({
      userId: z.string().min(1),
      targetId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {

      return ctx.db.favorite.create({
        data: input,
      });
    }),
  
  delete: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.favorite.delete({
        where: { id: input.id },
      });
    }),
});