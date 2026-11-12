import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logger } from "~/_utils";
import { isUniqueViolation } from "~/server/_db/errors";
import { findOrCreateThread } from "~/server/_db/messaging";
import { MAX_LIST_OFFSET } from "~/server/_db/pagination";
import { generateIcebreakers, generateMatchSummary } from "~/server/_lib/ai";
import { runAfterResponse } from "~/server/_lib/background";
import { RateLimits } from "~/server/_utils/rateLimit";
import { db as prismaDb } from "~/server/db";

import { createTRPCRouter, protectedProcedure, rateLimit } from "../trpc";

/** Most recent swipes excluded from a card deck. */
const MAX_SWIPES_CONSIDERED = 5000;

export const discoverRouter = createTRPCRouter({
  getCardDeck: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      try {
        // Get current user with preferences
        const currentUser = await ctx.db.user.findUnique({
          where: { id: userId },
          select: {
            city: true,
            state: true,
            seekingTypes: true,
            budgetMin: true,
            budgetMax: true,
          },
        });

        // Get IDs the user has already swiped on
        const swipedIds = await ctx.db.swipe.findMany({
          where: { swiperId: userId },
          select: { targetId: true },
          orderBy: { createdAt: "desc" },
          take: MAX_SWIPES_CONSIDERED,
        });
        const excludeIds = new Set([userId, ...swipedIds.map((s) => s.targetId)]);

        // Fetch discoverable users with photographer profiles
        const candidates = await ctx.db.user.findMany({
          where: {
            isDiscoverable: true,
            id: { notIn: [...excludeIds] },
            photographer: { isNot: null },
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePic: true,
            city: true,
            state: true,
            updatedAt: true,
            photographer: {
              select: {
                id: true,
                name: true,
                location: true,
                bio: true,
                avatar: true,
                companyName: true,
                website: true,
                instagram: true,
                portfolioImages: {
                  where: { isDeleted: false },
                  select: { image: true, tags: true, title: true },
                  orderBy: { isFeatured: "desc" },
                  take: 6,
                },
                reviews: {
                  select: { rating: true },
                  take: 200,
                },
                events: {
                  where: { isDeleted: false },
                  select: { id: true },
                  take: 200,
                },
              },
            },
          },
          take: 100, // fetch more than needed to score and rank
        });

        // Score and rank candidates
        const userCity = currentUser?.city?.toLowerCase() ?? "";
        const userState = currentUser?.state?.toLowerCase() ?? "";
        const seekingTypes: string[] = currentUser?.seekingTypes
          ? (JSON.parse(currentUser.seekingTypes) as string[])
          : [];

        const scored = candidates.map((candidate) => {
          let score = 0;

          // Location match (40% weight)
          const candCity = candidate.city?.toLowerCase() ?? "";
          const candState = candidate.state?.toLowerCase() ?? "";
          const photoLoc = candidate.photographer?.location?.toLowerCase() ?? "";
          if (userCity && (candCity === userCity || photoLoc.includes(userCity))) {
            score += 40;
          } else if (userState && (candState === userState || photoLoc.includes(userState))) {
            score += 20;
          } else {
            score += 4;
          }

          // Review score (25% weight)
          const reviews = candidate.photographer?.reviews ?? [];
          if (reviews.length > 0) {
            const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
            const ratingScore = avgRating / 5;
            const quantityScore = Math.min(reviews.length / 10, 1);
            score += ratingScore * quantityScore * 25;
          }

          // Specialization match (20% weight)
          if (seekingTypes.length > 0 && candidate.photographer) {
            const bio = candidate.photographer.bio?.toLowerCase() ?? "";
            const tags = candidate.photographer.portfolioImages
              ?.flatMap((img) => {
                try { return JSON.parse(img.tags) as string[]; } catch { return []; }
              })
              .map((t) => t.toLowerCase()) ?? [];
            const allText = [bio, ...tags].join(" ");
            const matchCount = seekingTypes.filter((t) =>
              allText.includes(t.toLowerCase()),
            ).length;
            score += (matchCount / seekingTypes.length) * 20;
          }

          // Activity recency (15% weight)
          const daysSinceActive = (Date.now() - candidate.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
          const recencyScore = Math.max(0, 1 - daysSinceActive / 90);
          score += recencyScore * 15;

          return { ...candidate, score };
        });

        scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, input.limit).map(({ score: _score, ...candidate }) => ({
          ...candidate,
          photographer: candidate.photographer
            ? {
                ...candidate.photographer,
                avgRating:
                  candidate.photographer.reviews.length > 0
                    ? candidate.photographer.reviews.reduce((s, r) => s + r.rating, 0) /
                      candidate.photographer.reviews.length
                    : null,
                reviewCount: candidate.photographer.reviews.length,
                eventCount: candidate.photographer.events.length,
                specializations: candidate.photographer.portfolioImages
                  ?.flatMap((img) => {
                    try { return JSON.parse(img.tags) as string[]; } catch { return []; }
                  })
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .slice(0, 5) ?? [],
              }
            : null,
        }));
      } catch (error) {
        logger.error("Failed to get card deck", { error, userId });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to load discover deck. Please try again.",
          cause: error,
        });
      }
    }),

  /**
   * Records a like or a pass, and creates the match when the like is mutual.
   *
   * Written without a transaction (Cloudflare D1 has none). Correctness under
   * concurrency rests on unique constraints instead:
   *
   * - Swipe(swiperId, targetId): repeating a swipe updates it.
   * - Match(user1Id, user2Id), ids sorted: when both users like each other at
   *   the same moment, both requests see the reciprocal like and both try to
   *   insert the match; exactly one insert succeeds and the other reads the
   *   winner's row. Each request writes its own like before it looks for the
   *   other's, so at least one of the two always sees both.
   * - MessageThread.participantKey: the pair gets one thread.
   *
   * Only the request that inserted the match sends the notifications, so they
   * are sent once. They are best effort: if that request dies after the
   * insert, the match still exists and both users see it in their list.
   */
  swipe: protectedProcedure
    .use(rateLimit(RateLimits.SWIPE))
    .input(
      z.object({
        targetId: z.string().min(1).max(64),
        direction: z.enum(["like", "pass"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { direction, targetId } = input;

      if (targetId === userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot swipe on yourself" });
      }

      try {
        // Only people who appear in Discover can be swiped on. The same
        // answer for "no such user" and "not discoverable" keeps this from
        // being a way to probe user ids.
        const target = await ctx.db.user.findFirst({
          select: { id: true },
          where: { id: targetId, isDiscoverable: true, photographer: { isNot: null } },
        });
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND", message: "This profile is not available" });
        }

        try {
          await ctx.db.swipe.create({
            data: { direction, swiperId: userId, targetId },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          // Already swiped (or a double submit): changing a pass to a like is allowed.
          await ctx.db.swipe.update({
            data: { direction },
            where: { swiperId_targetId: { swiperId: userId, targetId } },
          });
        }

        if (direction !== "like") {
          return { matched: false, matchId: null, threadId: null };
        }

        const reciprocal = await ctx.db.swipe.findFirst({
          select: { id: true },
          where: { direction: "like", swiperId: targetId, targetId: userId },
        });
        if (!reciprocal) {
          return { matched: false, matchId: null, threadId: null };
        }

        // Sorted ids give the pair one canonical (user1Id, user2Id) row.
        const [user1Id, user2Id] = userId < targetId ? [userId, targetId] : [targetId, userId];
        const thread = await findOrCreateThread(ctx.db, [userId, targetId]);

        let match;
        try {
          match = await ctx.db.match.create({
            data: {
              expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72h
              messageThreadId: thread.id,
              user1Id,
              user2Id,
            },
            select: { id: true, messageThreadId: true },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          // The pair is already matched: by an earlier swipe, or by the other
          // user's request racing this one.
          const existing = await ctx.db.match.findUnique({
            select: { id: true, messageThreadId: true },
            where: { user1Id_user2Id: { user1Id, user2Id } },
          });
          return existing
            ? { matched: true, matchId: existing.id, threadId: existing.messageThreadId }
            : { matched: false, matchId: null, threadId: null };
        }

        try {
          await ctx.db.notification.createMany({
            data: [targetId, userId].map((recipientId) => ({
              body: "You have a new match! Start a conversation before it expires.",
              linkUrl: `/app/discover/matches`,
              recipientId,
              title: "New Match!",
              type: "new_match",
            })),
          });
        } catch (error) {
          logger.error("Failed to create match notifications", { error, matchId: match.id });
        }

        runAfterResponse("match-summary", () =>
          generateMatchSummaryForMatch(match.id, userId, targetId),
        );

        return { matched: true, matchId: match.id, threadId: match.messageThreadId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        logger.error("Failed to record swipe", { error, userId, targetId });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to record swipe. Please try again.",
          cause: error,
        });
      }
    }),

  getMatches: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).max(MAX_LIST_OFFSET).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      try {
        const matches = await ctx.db.match.findMany({
          where: {
            OR: [{ user1Id: userId }, { user2Id: userId }],
            status: { not: "expired" },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: input.limit,
          skip: input.offset,
          select: {
            id: true,
            createdAt: true,
            status: true,
            aiSummary: true,
            expiresAt: true,
            messageThreadId: true,
            user1: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePic: true,
                city: true,
                state: true,
                photographer: {
                  select: {
                    companyName: true,
                    avatar: true,
                    location: true,
                  },
                },
              },
            },
            user2: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePic: true,
                city: true,
                state: true,
                photographer: {
                  select: {
                    companyName: true,
                    avatar: true,
                    location: true,
                  },
                },
              },
            },
          },
        });

        return matches.map((match) => {
          const otherUser = match.user1.id === userId ? match.user2 : match.user1;
          return {
            id: match.id,
            createdAt: match.createdAt,
            status: match.status,
            aiSummary: match.aiSummary,
            expiresAt: match.expiresAt,
            messageThreadId: match.messageThreadId,
            otherUser,
          };
        });
      } catch (error) {
        logger.error("Failed to get matches", { error, userId });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to load matches. Please try again.",
          cause: error,
        });
      }
    }),

  getMatchById: protectedProcedure
    // Each call asks the AI provider for icebreakers.
    .use(rateLimit(RateLimits.SEARCH))
    .input(z.object({ matchId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      try {
        const match = await ctx.db.match.findFirst({
          where: {
            id: input.matchId,
            OR: [{ user1Id: userId }, { user2Id: userId }],
          },
          select: {
            id: true,
            createdAt: true,
            status: true,
            aiSummary: true,
            expiresAt: true,
            messageThreadId: true,
            user1: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePic: true,
                city: true,
                state: true,
                photographer: {
                  select: {
                    name: true,
                    companyName: true,
                    bio: true,
                    avatar: true,
                    location: true,
                    portfolioImages: {
                      where: { isDeleted: false },
                      select: { image: true, tags: true, title: true },
                      take: 6,
                    },
                    reviews: { select: { rating: true } },
                  },
                },
              },
            },
            user2: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePic: true,
                city: true,
                state: true,
                photographer: {
                  select: {
                    name: true,
                    companyName: true,
                    bio: true,
                    avatar: true,
                    location: true,
                    portfolioImages: {
                      where: { isDeleted: false },
                      select: { image: true, tags: true, title: true },
                      take: 6,
                    },
                    reviews: { select: { rating: true } },
                  },
                },
              },
            },
          },
        });

        if (!match) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Match not found" });
        }

        const otherUser = match.user1.id === userId ? match.user2 : match.user1;
        const currentUser = match.user1.id === userId ? match.user1 : match.user2;

        // Generate icebreakers on demand
        const icebreakers = await generateIcebreakers(currentUser, otherUser);

        return {
          id: match.id,
          createdAt: match.createdAt,
          status: match.status,
          aiSummary: match.aiSummary,
          expiresAt: match.expiresAt,
          messageThreadId: match.messageThreadId,
          otherUser,
          icebreakers,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        logger.error("Failed to get match", { error, matchId: input.matchId, userId });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to load match details. Please try again.",
          cause: error,
        });
      }
    }),

  updatePreferences: protectedProcedure
    .input(
      z.object({
        isDiscoverable: z.boolean().optional(),
        seekingTypes: z.array(z.string().min(1).max(40)).max(20).optional(),
        budgetMin: z.number().int().min(0).max(1_000_000).optional().nullable(),
        budgetMax: z.number().int().min(0).max(1_000_000).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      try {
        return await ctx.db.user.update({
          where: { id: userId },
          data: {
            ...(input.isDiscoverable !== undefined && { isDiscoverable: input.isDiscoverable }),
            ...(input.seekingTypes !== undefined && {
              seekingTypes: JSON.stringify(input.seekingTypes),
            }),
            ...(input.budgetMin !== undefined && { budgetMin: input.budgetMin }),
            ...(input.budgetMax !== undefined && { budgetMax: input.budgetMax }),
          },
          select: {
            isDiscoverable: true,
            seekingTypes: true,
            budgetMin: true,
            budgetMax: true,
          },
        });
      } catch (error) {
        logger.error("Failed to update preferences", { error, userId });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update preferences. Please try again.",
          cause: error,
        });
      }
    }),

  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    try {
      const user = await ctx.db.user.findUnique({
        where: { id: userId },
        select: {
          isDiscoverable: true,
          seekingTypes: true,
          budgetMin: true,
          budgetMax: true,
          photographer: {
            select: { avatar: true },
          },
        },
      });
      return {
        isDiscoverable: user?.isDiscoverable ?? false,
        seekingTypes: user?.seekingTypes ? (JSON.parse(user.seekingTypes) as string[]) : [],
        budgetMin: user?.budgetMin ?? null,
        budgetMax: user?.budgetMax ?? null,
        photographer: user?.photographer ?? null,
      };
    } catch (error) {
      logger.error("Failed to get preferences", { error, userId });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to load preferences. Please try again.",
        cause: error,
      });
    }
  }),

  expireStaleMatches: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const result = await ctx.db.match.updateMany({
        where: {
          status: "matched",
          expiresAt: { lt: new Date() },
        },
        data: { status: "expired" },
      });
      return { expiredCount: result.count };
    } catch (error) {
      logger.error("Failed to expire stale matches", { error });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to expire stale matches.",
        cause: error,
      });
    }
  }),
});

/** Fire-and-forget helper to generate AI summary for a match */
async function generateMatchSummaryForMatch(
  matchId: string,
  userId1: string,
  userId2: string,
) {
  try {
    const prisma = prismaDb;

    const [u1, u2] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId1 },
        select: {
          firstName: true,
          lastName: true,
          city: true,
          state: true,
          photographer: {
            select: {
              name: true,
              location: true,
              bio: true,
              companyName: true,
              portfolioImages: {
                where: { isDeleted: false },
                select: { tags: true, title: true },
                take: 10,
              },
              reviews: { select: { rating: true } },
            },
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId2 },
        select: {
          firstName: true,
          lastName: true,
          city: true,
          state: true,
          photographer: {
            select: {
              name: true,
              location: true,
              bio: true,
              companyName: true,
              portfolioImages: {
                where: { isDeleted: false },
                select: { tags: true, title: true },
                take: 10,
              },
              reviews: { select: { rating: true } },
            },
          },
        },
      }),
    ]);

    if (!u1 || !u2) return;

    const summary = await generateMatchSummary(u1, u2);
    if (summary) {
      await prisma.match.update({
        where: { id: matchId },
        data: { aiSummary: summary },
      });
    }
  } catch (error) {
    logger.error("Failed to generate match summary", { error, matchId });
  }
}
