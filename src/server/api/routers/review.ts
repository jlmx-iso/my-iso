import { z } from "zod";

import { logger } from "~/_utils";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";

export const reviewRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      photographerId: z.string().min(1),
      rating: z.number().int().min(1).max(5),
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify the photographer exists
      const photographer = await ctx.db.photographer.findFirst({
        where: { id: input.photographerId },
      });

      if (!photographer) {
        throw new Error("Photographer not found");
      }

      // Prevent reviewing yourself
      if (photographer.userId === ctx.session.user.id) {
        throw new Error("You cannot review yourself");
      }

      // Check for existing review (one review per user per photographer)
      const existingReview = await ctx.db.review.findFirst({
        where: {
          photographerId: input.photographerId,
          userId: ctx.session.user.id,
        },
      });

      if (existingReview) {
        throw new Error("You have already reviewed this photographer");
      }

      logger.info("Creating review", {
        photographerId: input.photographerId,
        userId: ctx.session.user.id,
      });

      return ctx.db.review.create({
        data: {
          photographerId: input.photographerId,
          userId: ctx.session.user.id,
          rating: input.rating,
          title: input.title,
          description: input.description ?? null,
        },
      });
    }),

  getByPhotographerId: publicProcedure
    .input(z.object({ photographerId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.db.review.findMany({
        where: { photographerId: input.photographerId },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              profilePic: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  getAverageRating: publicProcedure
    .input(z.object({ photographerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const reviews = await ctx.db.review.findMany({
        where: { photographerId: input.photographerId },
        select: { rating: true },
      });

      if (reviews.length === 0) {
        return { average: 0, count: 0 };
      }

      const total = reviews.reduce((sum, review) => sum + review.rating, 0);
      const average = total / reviews.length;

      return {
        average: Math.round(average * 10) / 10,
        count: reviews.length,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const review = await ctx.db.review.findFirst({
        where: { id: input.id },
      });

      if (!review) {
        throw new Error("Review not found");
      }

      if (review.userId !== ctx.session.user.id) {
        throw new Error("Not authorized to delete this review");
      }

      logger.info("Deleting review", { reviewId: input.id, userId: ctx.session.user.id });

      return ctx.db.review.delete({
        where: { id: input.id },
      });
    }),
});
