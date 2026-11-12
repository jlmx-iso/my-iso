import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { instagramHandleOptional, logger } from "~/_utils";
import { env } from "~/env";
import { isUniqueViolation } from "~/server/_db/errors";
import { runAfterResponse } from "~/server/_lib/background";
import { sendTemplateEmail } from "~/server/_lib/email";
import { captureEvent } from "~/server/_lib/posthog";
import { hashEmail } from "~/server/_utils/hash";
import { checkRateLimit, RateLimits } from "~/server/_utils/rateLimit";
import { WAITLIST_APPROVED_CODE } from "~/server/_utils/roles";
import {
  createTRPCRouter,
  founderProcedure,
  publicProcedure,
  rateLimit,
} from "~/server/api/trpc";

const urlPattern = /^https?:\/\/.+/;

export const waitlistRouter = createTRPCRouter({
  /**
   * Submit a waitlist application (public).
   *
   * The answer is the same, `{ success: true, position: null }`, whether or
   * not the address was already on the list: the endpoint must not tell a
   * stranger who has applied. (That is also why no queue position is
   * returned: any number that moves with new entries gives it away.)
   * Either way the address gets the confirmation email; for an address
   * already on the list at most once a day.
   */
  submit: publicProcedure
    .use(rateLimit(RateLimits.WAITLIST_SUBMIT))
    .input(
      z.object({
        name: z.string().min(1).max(200),
        email: z.string().trim().email().max(254),
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
      const email = input.email.toLowerCase();

      let existing = await ctx.db.waitlist.findUnique({
        select: { name: true, status: true },
        where: { email },
      });

      if (!existing) {
        // Use max position + 1 (positions are for the admin's ordering only).
        const maxEntry = await ctx.db.waitlist.findFirst({
          orderBy: { position: "desc" },
          select: { position: true },
        });
        const position = (maxEntry?.position ?? 0) + 1;

        try {
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
        } catch (error) {
          // Two submissions of the same address at once: the unique email
          // let one in. This one is a repeat.
          if (!isUniqueViolation(error)) throw error;
          // What counts is the entry that got in, not this request's copy
          // of the form: its name (the two may differ) goes in the email,
          // and its status decides whether one is sent at all.
          existing = await ctx.db.waitlist.findUnique({
            select: { name: true, status: true },
            where: { email },
          });
          // No entry after all: this was not the conflict it looked like.
          if (!existing) throw error;
        }
      }

      let sendConfirmation = true;
      let name = input.name;
      if (existing) {
        name = existing.name;
        // A repeat gets the confirmation again (they may have lost it), but
        // only while still waiting, and at most once a day, so the form
        // cannot be used to mail someone over and over.
        sendConfirmation =
          existing.status === "pending" &&
          (await checkRateLimit(ctx.db, RateLimits.WAITLIST_RECONFIRM_EMAIL, `email:${email}`)).allowed;
      } else {
        // Analytics get a keyed hash of the address, never the address itself.
        captureEvent(await hashEmail(email), "waitlist_submitted", { role: input.userType ?? "unknown" });
      }

      if (sendConfirmation) {
        // After the response: how long the reply takes must not depend on
        // whether an email is sent, and a failure only gets logged.
        runAfterResponse("send-waitlist-confirmation", async () => {
          const emailResult = await sendTemplateEmail({
            email,
            props: { name },
            subject: "You're on the ISO waitlist — we'll be in touch",
            template: "waitlist-confirmation",
          });
          if (!emailResult.isOk) {
            logger.warn("Failed to send waitlist confirmation email", {
              error: emailResult.error?.message,
            });
          }
        });
      }

      /** `position` is always null; kept so older clients keep compiling. */
      const position: number | null = null;
      return { position, success: true };
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

      captureEvent(await hashEmail(entry.email), "waitlist_approved", {});

      // Send approval email (I1)
      // Include email so the join page can show "Sign in with the Google account matching {email}"
      const encodedEmail = encodeURIComponent(entry.email);
      // The app's configured public origin (never a hard-coded host).
      const joinUrl = new URL(
        `/join?waitlist=approved&email=${encodedEmail}`,
        env.NEXT_PUBLIC_BASE_URL,
      ).toString();
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
          error: emailResult.error?.message,
          waitlistId: entry.id,
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
