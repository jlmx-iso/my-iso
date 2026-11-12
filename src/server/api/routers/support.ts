import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { SUPPORT_EMAIL } from "~/_lib/site";
import { logger } from "~/_utils";
import { SUPPORT_MESSAGE_MAX, SUPPORT_MESSAGE_MIN, SUPPORT_SUBJECT_MAX } from "~/_utils/limits";
import { env } from "~/env";
import { sendEmail } from "~/server/_lib/email";
import { renderSupportRequestEmail } from "~/server/_lib/emails";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createTRPCRouter, proProcedure, rateLimit } from "~/server/api/trpc";

/** The inbox Pro requests go to (SUPPORT_INBOX_EMAIL, else the public support address). */
export function supportInbox(): string {
  return env.SUPPORT_INBOX_EMAIL ?? SUPPORT_EMAIL;
}

/** "[Pro] Billing question": the tag the inbox filters and prioritises on. */
export function supportSubject(subject: string): string {
  return `[Pro] ${subject}`;
}

export const supportRouter = createTRPCRouter({
  /**
   * Priority support: a Pro member's message to the support inbox, by email
   * (Resend), with "[Pro]" at the start of the subject. The email carries
   * the member's id, not their name or address; the team looks them up to
   * reply. Pro only (members without Pro use the public contact route), and
   * rate limited per member.
   *
   * Errors: SERVICE_UNAVAILABLE when the email could not be sent (nothing
   * was sent; the member is told to email the support address instead).
   */
  contact: proProcedure
    .use(rateLimit(RateLimits.SUPPORT_REQUEST))
    .use(rateLimit(RateLimits.SUPPORT_REQUEST_DAILY))
    .input(z.object({
      message: z.string().trim().min(SUPPORT_MESSAGE_MIN, `Tell us a little more (at least ${SUPPORT_MESSAGE_MIN} characters).`).max(SUPPORT_MESSAGE_MAX),
      subject: z.string().trim().min(1).max(SUPPORT_SUBJECT_MAX),
    }))
    .mutation(async ({ ctx, input }) => {
      const memberId = ctx.session.user.id;
      const subject = input.subject.replace(/\s+/g, " ");
      const html = await renderSupportRequestEmail({ memberId, message: input.message, subject });
      const sent = await sendEmail({ email: supportInbox(), html, subject: supportSubject(subject) });
      if (sent.isErr) {
        logger.error("Could not send a Pro support request", { error: sent.error, userId: memberId });
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: `Your message could not be sent. Please email ${SUPPORT_EMAIL} instead.`,
        });
      }
      return { sent: true as const };
    }),
});
