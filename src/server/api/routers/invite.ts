import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { generateUniqueInviteCode } from "~/server/_utils/invite";
import { checkRateLimit, RateLimits } from "~/server/_utils/rateLimit";
import { USER_ROLES } from "~/server/_utils/roles";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";

export const inviteRouter = createTRPCRouter({
  /**
   * Validate an invite code and return the inviter's name.
   */
  validate: publicProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // Rate limit invite code validation to prevent brute-force (M4)
      const ip = ctx.headers.get("x-forwarded-for") ?? "unknown";
      const rl = await checkRateLimit(`invite-validate:${ip}`, RateLimits.STRICT);
      if (!rl.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many attempts. Try again in ${rl.retryAfter}s.`,
        });
      }

      const inviteCode = await ctx.db.inviteCode.findUnique({
        where: { code: input.code.toUpperCase() },
        include: {
          creator: { select: { firstName: true, lastName: true } },
        },
      });

      if (
        !inviteCode ||
        inviteCode.currentRedemptions >= inviteCode.maxRedemptions
      ) {
        return { valid: false, inviterName: null };
      }

      return {
        valid: true,
        inviterName: `${inviteCode.creator.firstName} ${inviteCode.creator.lastName}`,
      };
    }),

  /**
   * Store a PendingInviteValidation so the signIn callback can verify
   * that this email was pre-approved with a valid code.
   */
  prepareRegistration: publicProcedure
    .input(
      z.object({
        code: z.string().min(1),
        email: z.string().email(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Rate limit registration preparation (M4)
      const ip = ctx.headers.get("x-forwarded-for") ?? "unknown";
      const rl = await checkRateLimit(`invite-prepare:${ip}`, RateLimits.STRICT);
      if (!rl.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many attempts. Try again in ${rl.retryAfter}s.`,
        });
      }

      const inviteCode = await ctx.db.inviteCode.findUnique({
        where: { code: input.code.toUpperCase() },
      });

      if (
        !inviteCode ||
        inviteCode.currentRedemptions >= inviteCode.maxRedemptions
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or exhausted invite code.",
        });
      }

      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      await ctx.db.pendingInviteValidation.upsert({
        where: { email: input.email.toLowerCase() },
        update: {
          code: input.code.toUpperCase(),
          expiresAt,
          createdAt: new Date(),
        },
        create: {
          email: input.email.toLowerCase(),
          code: input.code.toUpperCase(),
          expiresAt,
        },
      });

      return { success: true };
    }),

  /**
   * Redeem an invite code for the current user (post-registration).
   * Uses interactive transaction to prevent race conditions.
   */
  redeem: protectedProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const code = input.code.toUpperCase();

      // Check for duplicate redemption before entering transaction (I5)
      const existingRedemption = await ctx.db.inviteRedemption.findFirst({
        where: { redeemedById: userId },
      });
      if (existingRedemption) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You have already redeemed an invite code.",
        });
      }

      // Interactive transaction prevents race condition (C1)
      await ctx.db.$transaction(async (tx) => {
        const inviteCode = await tx.inviteCode.findUnique({
          where: { code },
        });

        if (
          !inviteCode ||
          inviteCode.currentRedemptions >= inviteCode.maxRedemptions
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid or exhausted invite code.",
          });
        }

        // Prevent self-invite
        if (inviteCode.creatorId === userId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You cannot use your own invite code.",
          });
        }

        await tx.inviteCode.update({
          where: { id: inviteCode.id },
          data: { currentRedemptions: { increment: 1 } },
        });
        await tx.inviteRedemption.create({
          data: {
            inviteCodeId: inviteCode.id,
            redeemedById: userId,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            role: USER_ROLES.FOUNDING_MEMBER,
            invitedByUserId: inviteCode.creatorId,
          },
        });
      });

      return { success: true };
    }),

  /**
   * Get the current user's invite code with redemption list.
   */
  getMyCode: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const inviteCode = await ctx.db.inviteCode.findUnique({
      where: { creatorId: userId },
      include: {
        redemptions: {
          include: {
            redeemedBy: {
              select: {
                firstName: true,
                lastName: true,
                profilePic: true,
              },
            },
          },
          orderBy: { redeemedAt: "desc" },
        },
      },
    });

    if (!inviteCode) {
      // Auto-generate one for the user
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { firstName: true },
      });

      const code = await generateUniqueInviteCode(
        user.firstName,
        async (c) => {
          const exists = await ctx.db.inviteCode.findUnique({ where: { code: c } });
          return exists !== null;
        },
      );

      const newCode = await ctx.db.inviteCode.create({
        data: { code, creatorId: userId },
        include: {
          redemptions: {
            include: {
              redeemedBy: {
                select: {
                  firstName: true,
                  lastName: true,
                  profilePic: true,
                },
              },
            },
          },
        },
      });

      return newCode;
    }

    return inviteCode;
  }),

  /**
   * Regenerate the invite code string (keeps counter and redemptions).
   */
  regenerate: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const existing = await ctx.db.inviteCode.findUnique({
      where: { creatorId: userId },
    });

    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No invite code found.",
      });
    }

    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firstName: true },
    });

    const code = await generateUniqueInviteCode(
      user.firstName,
      async (c) => {
        const collision = await ctx.db.inviteCode.findUnique({ where: { code: c } });
        return collision !== null;
      },
    );

    const updated = await ctx.db.inviteCode.update({
      where: { id: existing.id },
      data: { code, regeneratedAt: new Date() },
    });

    return updated;
  }),
});
