import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { consentFromHeaders, consentRequiresOptIn, COUNTRY_HEADER } from "~/_lib/consent";
import { logger } from "~/_utils";
import { requestAccountDeletion, runAccountDeletion } from "~/server/_lib/account/deletion";
import { accountDeletionDeps } from "~/server/_lib/account/deletionDeps";
import { buildAccountExport } from "~/server/_lib/account/exportData";
import { captureServerException } from "~/server/_lib/posthog";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createTRPCRouter, protectedProcedure, rateLimit } from "~/server/api/trpc";

/** What the member types to confirm: their username, or their email without one. */
export function deletionConfirmationMatches(
  user: { email: string; handle: string | null },
  typed: string,
): boolean {
  const expected = (user.handle ?? user.email).trim().toLowerCase();
  return typed.trim().replace(/^@/, "").toLowerCase() === expected;
}

/**
 * The member's own data: download it, or delete the account.
 * SECURITY: both act on ctx.session.user.id only; no user id in the input.
 */
export const accountRouter = createTRPCRouter({
  /**
   * Everything ISO stores about the caller, as one JSON document
   * (~/server/_lib/account/exportData). A mutation: it is generated on
   * request, rate limited, and never cached.
   */
  exportData: protectedProcedure
    .use(rateLimit(RateLimits.ACCOUNT_EXPORT))
    .mutation(async ({ ctx }) => {
      return buildAccountExport(ctx.db, ctx.session.user.id, {
        consent: {
          choice: consentFromHeaders(ctx.headers),
          optInRegion: consentRequiresOptIn(ctx.headers.get(COUNTRY_HEADER)),
        },
      });
    }),

  /**
   * Deletes the caller's account (~/server/_lib/account/deletion). The
   * account closes with the first statement; if a later step fails, the
   * finish-deletions job completes it, and the answer is "scheduled".
   */
  deleteAccount: protectedProcedure
    .use(rateLimit(RateLimits.ACCOUNT_DELETE))
    .input(z.object({ confirmation: z.string().max(320) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await ctx.db.user.findUnique({
        select: { email: true, handle: true },
        where: { id: userId },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });
      if (!deletionConfirmationMatches(user, input.confirmation)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: user.handle
            ? "Type your username exactly to confirm."
            : "Type your email address exactly to confirm.",
        });
      }

      await requestAccountDeletion(ctx.db, userId);
      try {
        const outcome = await runAccountDeletion(ctx.db, userId, accountDeletionDeps);
        logger.info("Account deleted", { outcome });
        return { status: "deleted" as const };
      } catch (error) {
        // Closed already; the job finishes the rest.
        logger.error("Account deletion did not finish; the job will retry", { error });
        captureServerException(error, { path: "account.deleteAccount", source: "account-deletion" });
        return { status: "scheduled" as const };
      }
    }),
});
