import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { isUniqueViolation } from "~/server/_db/errors";
import {
  claimInviteSlot,
  ensureInviteCode,
  releaseInviteSlot,
} from "~/server/_db/invite";
import { generateInviteCode, normalizeInviteCode } from "~/server/_utils/invite";
import { RateLimits } from "~/server/_utils/rateLimit";
import { USER_ROLES, WAITLIST_APPROVED_CODE } from "~/server/_utils/roles";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  rateLimit,
} from "~/server/api/trpc";

const codeInput = z.string().trim().min(1).max(64);

/** Redemptions returned with the caller's own code. */
const MAX_REDEMPTIONS_LISTED = 100;

const redemptionsInclude = {
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
    take: MAX_REDEMPTIONS_LISTED,
  },
} as const;

export const inviteRouter = createTRPCRouter({
  /**
   * Validate an invite code. Public, so it is rate limited per IP and gives
   * away as little as possible: only the inviter's first name, enough for
   * the invitee to recognise who invited them.
   */
  validate: publicProcedure
    .use(rateLimit(RateLimits.INVITE_VALIDATE))
    .input(z.object({ code: codeInput }))
    .query(async ({ ctx, input }) => {
      const inviteCode = await ctx.db.inviteCode.findUnique({
        where: { code: normalizeInviteCode(input.code) },
        select: {
          creator: { select: { firstName: true } },
          currentRedemptions: true,
          maxRedemptions: true,
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
        inviterName: inviteCode.creator.firstName,
      };
    }),

  /**
   * Store a PendingInviteValidation so that sign-up (src/auth.ts) knows which
   * code this email address intends to redeem.
   *
   * Nothing is reserved here on purpose: this endpoint is unauthenticated, so
   * a reservation would let anyone who knows a code hold all of its slots.
   * The slot is claimed atomically when the account is actually created, and
   * sign-up is refused at that point if the code has run out.
   */
  prepareRegistration: publicProcedure
    .use(rateLimit(RateLimits.INVITE_PREPARE))
    .input(
      z.object({
        code: codeInput,
        email: z.string().trim().toLowerCase().email().max(254),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const code = normalizeInviteCode(input.code);
      const now = new Date();

      const inviteCode = await ctx.db.inviteCode.findUnique({
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

      // Opportunistic cleanup: delete expired PendingInviteValidation records
      // to prevent unbounded table growth (no cron needed)
      await ctx.db.pendingInviteValidation.deleteMany({
        where: { expiresAt: { lt: now } },
      });

      // A waitlist approval is worth more than an invite code (it lasts a
      // week and needs no slot). Never let an anonymous caller replace one.
      const existing = await ctx.db.pendingInviteValidation.findUnique({
        where: { email: input.email },
      });
      if (existing?.code === WAITLIST_APPROVED_CODE && existing.expiresAt > now) {
        return { success: true };
      }

      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

      await ctx.db.pendingInviteValidation.upsert({
        where: { email: input.email },
        update: { code, expiresAt, createdAt: now },
        create: { email: input.email, code, expiresAt },
      });

      return { success: true };
    }),

  /**
   * Redeem an invite code for the current user (post-registration).
   *
   * No transaction (D1 has none): the slot is claimed with one conditional
   * UPDATE, and the unique InviteRedemption.redeemedById makes a second
   * redemption by the same user fail, in which case the slot is given back.
   *
   * NOTE: Currently unused by the UI — invite redemption happens during
   * sign-up in src/auth.ts.
   */
  redeem: protectedProcedure
    .use(rateLimit(RateLimits.INVITE_VALIDATE))
    .input(z.object({ code: codeInput }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const code = normalizeInviteCode(input.code);

      const own = await ctx.db.inviteCode.findUnique({
        select: { creatorId: true },
        where: { code },
      });
      if (own?.creatorId === userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot use your own invite code.",
        });
      }

      const slot = await claimInviteSlot(ctx.db, code);
      if (!slot) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or exhausted invite code.",
        });
      }

      try {
        // The code may have been regenerated onto the caller between the
        // check above and the claim; the claim's own row is authoritative.
        if (slot.creatorId === userId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You cannot use your own invite code.",
          });
        }
        await ctx.db.inviteRedemption.create({
          data: { inviteCodeId: slot.inviteCodeId, redeemedById: userId },
        });
      } catch (error) {
        await releaseInviteSlot(ctx.db, slot.inviteCodeId);
        if (isUniqueViolation(error)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You have already redeemed an invite code.",
          });
        }
        throw error;
      }

      // Founders and ambassadors keep their role.
      await ctx.db.user.updateMany({
        where: { id: userId, role: USER_ROLES.STANDARD },
        data: { role: USER_ROLES.FOUNDING_MEMBER },
      });
      await ctx.db.user.update({
        where: { id: userId },
        data: { invitedByUserId: slot.creatorId },
      });

      return { success: true };
    }),

  /**
   * Get the current user's invite code with redemption list.
   */
  getMyCode: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const existing = await ctx.db.inviteCode.findUnique({
      where: { creatorId: userId },
      include: redemptionsInclude,
    });
    if (existing) return existing;

    // First visit: generate one.
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firstName: true },
    });
    const created = await ensureInviteCode(ctx.db, userId, user.firstName);

    return ctx.db.inviteCode.findUniqueOrThrow({
      where: { id: created.id },
      include: redemptionsInclude,
    });
  }),

  /**
   * Regenerate the invite code string (keeps counter and redemptions).
   */
  regenerate: protectedProcedure
    .use(rateLimit(RateLimits.INVITE_PREPARE))
    .mutation(async ({ ctx }) => {
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

      // `code` is unique: a collision fails the update and a new one is drawn.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await ctx.db.inviteCode.update({
            where: { id: existing.id },
            data: {
              code: generateInviteCode(user.firstName || "USER"),
              regeneratedAt: new Date(),
            },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not generate a new invite code. Please try again.",
      });
    }),
});
