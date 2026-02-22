import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logger } from "~/_utils";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";

/**
 * Generate a short, readable referral code.
 * Format: 8 lowercase alphanumeric characters.
 */
function generateReferralCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars (0,o,1,l,i)
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i]! % chars.length];
  }
  return code;
}

export const referralRouter = createTRPCRouter({
  /**
   * Get or create a unique referral code for the current user.
   * If the user already has a pending referral code, return it.
   * Otherwise, create a new one.
   */
  getMyCode: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Check if user already has a referral code they created
    const existing = await ctx.db.referral.findFirst({
      where: {
        referrerId: userId,
        status: "pending",
        referredId: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      return existing.code;
    }

    // Generate a unique code (retry on collision)
    let code = generateReferralCode();
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      const collision = await ctx.db.referral.findUnique({
        where: { code },
      });
      if (!collision) break;
      code = generateReferralCode();
      attempts++;
    }

    if (attempts >= maxAttempts) {
      logger.error("Failed to generate unique referral code after max attempts", {
        userId,
      });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to generate referral code. Please try again.",
      });
    }

    const referral = await ctx.db.referral.create({
      data: {
        referrerId: userId,
        code,
        status: "pending",
      },
    });

    logger.info("Referral code created", { userId, code: referral.code });
    return referral.code;
  }),

  /**
   * Returns all referrals sent by the current user with status and referred user info.
   */
  getMyReferrals: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const referrals = await ctx.db.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        referred: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            profilePic: true,
          },
        },
      },
    });

    return referrals;
  }),

  /**
   * Returns referral statistics for the current user:
   * - total referrals sent
   * - total signed up
   * - total rewarded
   */
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [totalSent, totalSignedUp, totalRewarded] = await Promise.all([
      ctx.db.referral.count({
        where: { referrerId: userId },
      }),
      ctx.db.referral.count({
        where: {
          referrerId: userId,
          status: { in: ["signed_up", "rewarded"] },
        },
      }),
      ctx.db.referral.count({
        where: {
          referrerId: userId,
          status: "rewarded",
        },
      }),
    ]);

    return {
      totalSent,
      totalSignedUp,
      totalRewarded,
    };
  }),

  /**
   * Public procedure to validate a referral code.
   * Returns whether the code is valid (exists and status is "pending").
   * Does NOT reveal who the referrer is.
   */
  validateCode: publicProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const referral = await ctx.db.referral.findUnique({
        where: { code: input.code },
        select: { status: true, referredId: true },
      });

      const isValid =
        referral !== null &&
        referral.status === "pending" &&
        referral.referredId === null;

      return { isValid };
    }),

  /**
   * Links the current user as the referred user on a referral code.
   * Updates status to "signed_up".
   * Fails if the code is invalid, already claimed, or the user is the referrer.
   */
  claimReferral: protectedProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check if user has already been referred by any code
      const alreadyReferred = await ctx.db.referral.findFirst({
        where: { referredId: userId },
      });

      if (alreadyReferred) {
        logger.warn("User already referred, skipping claim", {
          userId,
          code: input.code,
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You have already been referred.",
        });
      }

      // Find the referral code
      const referral = await ctx.db.referral.findUnique({
        where: { code: input.code },
      });

      if (!referral) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Referral code not found.",
        });
      }

      if (referral.status !== "pending" || referral.referredId !== null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This referral code has already been used.",
        });
      }

      // Prevent self-referral
      if (referral.referrerId === userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot use your own referral code.",
        });
      }

      // Claim the referral
      await ctx.db.referral.update({
        where: { id: referral.id },
        data: {
          referredId: userId,
          status: "signed_up",
        },
      });

      logger.info("Referral claimed", {
        userId,
        code: input.code,
        referrerId: referral.referrerId,
      });

      return { success: true };
    }),
});
