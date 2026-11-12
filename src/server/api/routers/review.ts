import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { isUniqueViolation } from "~/server/_db/errors";
import { toPage } from "~/server/_db/pagination";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createTRPCRouter, protectedProcedure, publicProcedure, rateLimit } from "~/server/api/trpc";

const idInput = z.string().min(1).max(64);

const REVIEWS_PAGE_SIZE = 50;

const reviewsInput = z.object({
  cursor: idInput.optional(),
  limit: z.number().int().min(1).max(REVIEWS_PAGE_SIZE).default(REVIEWS_PAGE_SIZE),
  photographerId: idInput,
});

/**
 * A photographer's reviews, newest first (`extra` rows are for toPage), with
 * the reviewer's display name and picture but not their user id.
 */
function findReviews(
  db: Pick<ExtendedPrismaClient, "review">,
  input: z.infer<typeof reviewsInput>,
  extra: 0 | 1,
) {
  return db.review.findMany({
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      createdAt: true,
      description: true,
      id: true,
      photographerId: true,
      rating: true,
      title: true,
      updatedAt: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          profilePic: true,
        },
      },
    },
    take: input.limit + extra,
    where: { photographerId: input.photographerId },
  });
}

const ALREADY_REVIEWED = "You have already reviewed this photographer";

export const reviewRouter = createTRPCRouter({
  create: protectedProcedure
    .use(rateLimit(RateLimits.REVIEW_CREATE))
    .input(z.object({
      photographerId: idInput,
      rating: z.number().int().min(1).max(5),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify the photographer exists
      const photographer = await ctx.db.photographer.findFirst({
        select: { userId: true },
        where: { id: input.photographerId },
      });

      if (!photographer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Photographer not found" });
      }

      // Prevent reviewing yourself
      if (photographer.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot review yourself" });
      }

      // One review per reviewer per photographer is enforced by the unique
      // constraint Review(photographerId, userId): two simultaneous submits
      // cannot both insert, whatever a prior read would have shown.
      try {
        return await ctx.db.review.create({
          data: {
            photographerId: input.photographerId,
            userId: ctx.session.user.id,
            rating: input.rating,
            title: input.title,
            description: input.description || null,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({ code: "CONFLICT", message: ALREADY_REVIEWED });
        }
        throw error;
      }
    }),

  /**
   * Public: shown on the shareable profile page. The newest reviews first,
   * as a plain array (`cursor` is the id of the last review received).
   * getPageByPhotographerId returns the same as `{ items, nextCursor }`.
   */
  getByPhotographerId: publicProcedure
    .input(reviewsInput)
    .query(({ ctx, input }) => findReviews(ctx.db, input, 0)),

  getPageByPhotographerId: publicProcedure
    .input(reviewsInput)
    .query(async ({ ctx, input }) => toPage(await findReviews(ctx.db, input, 1), input.limit)),

  /**
   * The caller's own review of a photographer, or null: lets the profile
   * show "your review" instead of a form that could only answer "already
   * reviewed". (The public list deliberately carries no reviewer ids.)
   */
  getMine: protectedProcedure
    .input(z.object({ photographerId: idInput }))
    .query(({ ctx, input }) =>
      ctx.db.review.findUnique({
        select: { createdAt: true, description: true, id: true, rating: true, title: true },
        where: {
          photographerId_userId: { photographerId: input.photographerId, userId: ctx.session.user.id },
        },
      }),
    ),

  getAverageRating: publicProcedure
    .input(z.object({ photographerId: idInput }))
    .query(async ({ ctx, input }) => {
      // Aggregated in the database: no rows are loaded, however many exist.
      const result = await ctx.db.review.aggregate({
        _avg: { rating: true },
        _count: { _all: true },
        where: { photographerId: input.photographerId },
      });

      const count = result._count._all;
      const average = result._avg.rating ?? 0;

      return {
        average: Math.round(average * 10) / 10,
        count,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: idInput }))
    .mutation(async ({ ctx, input }) => {
      // Scoped to the caller's own reviews.
      const result = await ctx.db.review.deleteMany({
        where: { id: input.id, userId: ctx.session.user.id },
      });

      if (result.count === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
      }

      return { id: input.id };
    }),
});
