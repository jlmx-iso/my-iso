import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logger } from "~/_utils";
import { db as prismaDb } from "~/server/db";
import { generateIcebreakers, generateMatchSummary } from "~/server/_lib/ai";
import { createTRPCRouter, protectedProcedure } from "../trpc";

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
                },
                events: {
                  where: { isDeleted: false },
                  select: { id: true },
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

  swipe: protectedProcedure
    .input(
      z.object({
        targetId: z.string().min(1),
        direction: z.enum(["like", "pass"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.targetId === userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot swipe on yourself" });
      }

      try {
        // Upsert the swipe (allows changing a pass to a like)
        await ctx.db.swipe.upsert({
          where: {
            swiperId_targetId: { swiperId: userId, targetId: input.targetId },
          },
          create: {
            swiperId: userId,
            targetId: input.targetId,
            direction: input.direction,
          },
          update: {
            direction: input.direction,
          },
        });

        // Check for mutual like
        if (input.direction === "like") {
          const reciprocal = await ctx.db.swipe.findFirst({
            where: {
              swiperId: input.targetId,
              targetId: userId,
              direction: "like",
            },
          });

          if (reciprocal) {
            // Ensure consistent ordering for the unique constraint
            const [user1Id, user2Id] = [userId, input.targetId].sort();

            // Check if match already exists
            const existingMatch = await ctx.db.match.findUnique({
              where: { user1Id_user2Id: { user1Id: user1Id!, user2Id: user2Id! } },
            });

            if (!existingMatch) {
              // Create match with message thread in a transaction
              const match = await ctx.db.$transaction(async (tx) => {
                const thread = await tx.messageThread.create({
                  data: {
                    participants: {
                      connect: [{ id: userId }, { id: input.targetId }],
                    },
                  },
                });

                const newMatch = await tx.match.create({
                  data: {
                    user1Id: user1Id!,
                    user2Id: user2Id!,
                    messageThreadId: thread.id,
                    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72h
                  },
                });

                // Create notifications for both users
                await tx.notification.create({
                  data: {
                    recipientId: input.targetId,
                    type: "new_match",
                    title: "New Match!",
                    body: "You have a new match! Start a conversation before it expires.",
                    linkUrl: `/app/discover/matches`,
                  },
                });

                await tx.notification.create({
                  data: {
                    recipientId: userId,
                    type: "new_match",
                    title: "New Match!",
                    body: "You have a new match! Start a conversation before it expires.",
                    linkUrl: `/app/discover/matches`,
                  },
                });

                return { ...newMatch, threadId: thread.id };
              });

              // Generate AI summary async (fire and forget)
              void generateMatchSummaryForMatch(match.id, userId, input.targetId);

              return { matched: true, matchId: match.id, threadId: match.threadId };
            }
          }
        }

        return { matched: false, matchId: null, threadId: null };
      } catch (error) {
        logger.error("Failed to record swipe", { error, userId, targetId: input.targetId });
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
        limit: z.number().min(1).max(50).default(20),
        offset: z.number().min(0).default(0),
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
          orderBy: { createdAt: "desc" },
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
        seekingTypes: z.array(z.string()).optional(),
        budgetMin: z.number().int().min(0).optional().nullable(),
        budgetMax: z.number().int().min(0).optional().nullable(),
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
