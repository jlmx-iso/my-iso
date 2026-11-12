import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { ErrorReason } from "~/_utils";
import { isUniqueViolation } from "~/server/_db/errors";
import { toPage } from "~/server/_db/pagination";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { RateLimits } from "~/server/_utils/rateLimit";
import { reasonedError } from "~/server/api/reasonedError";
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

/**
 * Whether the two users have worked together: a completed booking between
 * them, whichever of them was the applicant, on an event that still exists.
 */
async function haveWorkedTogether(
  db: Pick<ExtendedPrismaClient, "booking">,
  userA: string,
  userB: string,
): Promise<boolean> {
  const booking = await db.booking.findFirst({
    select: { id: true },
    where: {
      event: { isDeleted: false },
      OR: [
        { applicantId: userA, ownerId: userB },
        { applicantId: userB, ownerId: userA },
      ],
      status: "completed",
    },
  });
  return booking !== null;
}

/** Why the caller cannot review a photographer right now. */
type ReviewBlocker = "self" | "no_completed_booking" | "already_reviewed";

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
        throw reasonedError("BAD_REQUEST", ErrorReason.REVIEW_SELF, "You cannot review yourself");
      }

      // Reviews are for people who have worked together.
      if (!(await haveWorkedTogether(ctx.db, ctx.session.user.id, photographer.userId))) {
        throw reasonedError(
          "FORBIDDEN",
          ErrorReason.REVIEW_NOT_ELIGIBLE,
          "You can review a photographer once you have completed a booking together.",
        );
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
          throw reasonedError("CONFLICT", ErrorReason.REVIEW_EXISTS, ALREADY_REVIEWED);
        }
        throw error;
      }
    }),

  /**
   * Whether the caller may review this photographer, and their review if
   * they already wrote one. For deciding whether to show the review form:
   *
   * - `canReview`: true only when a `create` would be accepted now.
   * - `blocker`: why not ("self", "no_completed_booking",
   *   "already_reviewed"), or null.
   * - `hasReviewed`, `myReview`: the caller's existing review, or null.
   *
   * An unknown photographer id answers like one the caller has not worked
   * with.
   */
  getMyReviewState: protectedProcedure
    .input(z.object({ photographerId: idInput }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [photographer, myReview] = await Promise.all([
        ctx.db.photographer.findFirst({
          select: { userId: true },
          where: { id: input.photographerId },
        }),
        ctx.db.review.findUnique({
          select: { createdAt: true, description: true, id: true, rating: true, title: true },
          where: { photographerId_userId: { photographerId: input.photographerId, userId } },
        }),
      ]);

      let blocker: ReviewBlocker | null = null;
      if (photographer?.userId === userId) blocker = "self";
      else if (myReview) blocker = "already_reviewed";
      else if (!photographer || !(await haveWorkedTogether(ctx.db, userId, photographer.userId))) {
        blocker = "no_completed_booking";
      }

      return { blocker, canReview: blocker === null, hasReviewed: myReview !== null, myReview };
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
