import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { instagramHandleOptional, logger } from "~/_utils";
import { sendTemplateEmail } from "~/server/_lib/email";
import { checkRateLimit, RateLimits } from "~/server/_utils/rateLimit";
import { WAITLIST_APPROVED_CODE } from "~/server/_utils/roles";
import {
  createTRPCRouter,
  founderProcedure,
  publicProcedure,
} from "~/server/api/trpc";

const urlPattern = /^https?:\/\/.+/;

export const waitlistRouter = createTRPCRouter({
  /**
   * Submit a waitlist application (public).
   */
  submit: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        email: z.string().email(),
        instagram: instagramHandleOptional,
        website: z.string().max(500).refine(
          (v) => !v || urlPattern.test(v),
          { message: "Website must be a valid URL starting with http:// or https://" },
        ).optional(),
        userType: z.enum(["lead", "second", "both"]).default("both"),
        referralSource: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Rate limit waitlist submissions (M4)
      const ip = ctx.headers.get("x-forwarded-for") ?? "unknown";
      const rl = await checkRateLimit(`waitlist-submit:${ip}`, RateLimits.STRICT);
      if (!rl.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many attempts. Try again in ${rl.retryAfter}s.`,
        });
      }

      const email = input.email.toLowerCase();

      const existing = await ctx.db.waitlist.findUnique({
        where: { email },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This email is already on the waitlist.",
        });
      }

      // Use max position + 1 to avoid race condition on concurrent inserts (M2)
      const maxEntry = await ctx.db.waitlist.findFirst({
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const position = (maxEntry?.position ?? 0) + 1;

      await ctx.db.waitlist.create({
        data: {
          name: input.name,
          email,
          instagram: input.instagram,
          website: input.website,
          userType: input.userType,
          referralSource: input.referralSource,
          position,
        },
      });

      // Send confirmation email — awaited for logging, but failure does not throw
      const emailResult = await sendTemplateEmail({
        email,
        props: { name: input.name },
        subject: "You're on the ISO waitlist — we'll be in touch",
        template: "waitlist-confirmation",
      });

      if (!emailResult.isOk) {
        logger.warn("Failed to send waitlist confirmation email", {
          email,
          error: emailResult.error?.message,
        });
      }

      return { success: true, position };
    }),

  /**
   * Get all waitlist entries (founder-only). Paginated and filterable by status.
   */
  getAll: founderProcedure
    .input(
      z.object({
        status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where =
        input.status === "all" ? {} : { status: input.status };

      const [items, total] = await Promise.all([
        ctx.db.waitlist.findMany({
          where,
          orderBy: { createdAt: "asc" },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          include: {
            reviewedBy: {
              select: { firstName: true, lastName: true },
            },
          },
        }),
        ctx.db.waitlist.count({ where }),
      ]);

      return {
        items,
        total,
        page: input.page,
        totalPages: Math.ceil(total / input.limit),
      };
    }),

  /**
   * Approve a waitlist entry (founder-only).
   * Creates a PendingInviteValidation and sends approval email.
   */
  approve: founderProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.waitlist.findUnique({
        where: { id: input.id },
      });

      if (!entry) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (entry.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Entry has already been reviewed.",
        });
      }

      // Create a PendingInviteValidation so the user can sign up (I2)
      // Uses a special code that bypasses invite code redemption
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await ctx.db.pendingInviteValidation.upsert({
        where: { email: entry.email },
        update: {
          code: WAITLIST_APPROVED_CODE,
          expiresAt,
          createdAt: new Date(),
        },
        create: {
          email: entry.email,
          code: WAITLIST_APPROVED_CODE,
          expiresAt,
        },
      });

      await ctx.db.waitlist.update({
        where: { id: input.id },
        data: {
          status: "approved",
          reviewedAt: new Date(),
          reviewedById: ctx.session.user.id,
        },
      });

      // Send approval email (I1)
      // Include email so the join page can show "Sign in with the Google account matching {email}"
      const encodedEmail = encodeURIComponent(entry.email);
      const joinUrl = `${process.env.NEXTAUTH_URL ?? "https://myiso.app"}/join?waitlist=approved&email=${encodedEmail}`;
      const emailResult = await sendTemplateEmail({
        email: entry.email,
        subject: "You're in! Your spot on ISO is ready",
        template: "waitlist-approved",
        props: {
          name: entry.name,
          joinUrl,
        },
      });

      if (!emailResult.isOk) {
        logger.warn("Failed to send waitlist approval email", {
          email: entry.email,
          error: emailResult.error?.message,
        });
      }

      return { success: true };
    }),

  /**
   * Reject a waitlist entry (founder-only).
   */
  reject: founderProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.waitlist.findUnique({
        where: { id: input.id },
      });

      if (!entry) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (entry.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Entry has already been reviewed.",
        });
      }

      await ctx.db.waitlist.update({
        where: { id: input.id },
        data: {
          status: "rejected",
          reviewedAt: new Date(),
          reviewedById: ctx.session.user.id,
        },
      });

      return { success: true };
    }),
});
