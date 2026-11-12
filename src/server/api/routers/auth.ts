import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logger } from "~/_utils";
import { env } from "~/env";
import { issueOtp, verifyOtp } from "~/server/_db/verificationToken";
import { runAfterResponse } from "~/server/_lib/background";
import { captureEvent } from "~/server/_lib/posthog";
import { signMobileToken } from "~/server/_utils/auth/mobileToken";
import { getClientIp, isCloudflareRuntime } from "~/server/_utils/clientIp";
import {
  enforceRateLimitsInOrder,
  otpRequestLimits,
  otpVerifyLimits,
  RateLimits,
} from "~/server/_utils/rateLimit";
import { createTRPCRouter, publicProcedure, rateLimit } from "~/server/api/trpc";

/** Local `next dev` only: a fixed code, returned to the client, no email. */
const DEV_OTP_CODE = "000000";

function isLocalDevelopment(): boolean {
  return env.NODE_ENV === "development" && !isCloudflareRuntime();
}

const emailInput = z.string().trim().toLowerCase().email().max(254);

export const authRouter = createTRPCRouter({
  exchangeMobileToken: publicProcedure
    .use(rateLimit(RateLimits.MOBILE_TOKEN_EXCHANGE))
    .input(z.object({
      idToken: z.string().min(1).max(8192),
    }))
    .mutation(async ({ ctx, input }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let tokenInfoRes: Response;
      try {
        const tokenInfoUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
        tokenInfoUrl.searchParams.set("id_token", input.idToken);
        tokenInfoRes = await fetch(tokenInfoUrl, { signal: controller.signal });
      } catch (error) {
        logger.error("Google tokeninfo request failed", { error });
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Unable to validate Google ID token",
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!tokenInfoRes.ok) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid Google ID token' });
      }

      const tokenInfo = await tokenInfoRes.json() as {
        aud?: string;
        email?: string;
        email_verified?: string;
        exp?: string;
        given_name?: string;
        family_name?: string;
        iss?: string;
      };

      if (tokenInfo.aud !== env.GOOGLE_CLIENT_ID) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid Google ID token' });
      }

      if (
        tokenInfo.iss !== "accounts.google.com" &&
        tokenInfo.iss !== "https://accounts.google.com"
      ) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid Google ID token' });
      }

      if (!tokenInfo.exp || Date.now() / 1000 > parseInt(tokenInfo.exp, 10)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Google ID token has expired' });
      }

      if (tokenInfo.email_verified !== "true") {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Google account email is not verified' });
      }

      if (!tokenInfo.email) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid Google ID token' });
      }

      const normalizedEmail = tokenInfo.email.toLowerCase();

      const user = await ctx.db.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });

      // The caller has just proven ownership of this address to Google, so
      // telling them it has no account here discloses nothing about others.
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No account found. Please sign up on the web first.' });
      }

      const token = await signMobileToken(user.id);

      captureEvent(user.id, 'user_signed_in', { provider: 'google', platform: 'ios' });

      return { token, userId: user.id };
    }),

  /**
   * Emails a sign-in code. Used by the web login/join forms and the mobile
   * app. The response is the same whether or not the address can sign in,
   * and whether or not the email could be sent.
   */
  requestMobileOtp: publicProcedure
    .input(z.object({ email: emailInput }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email;

      // Per client, then per address (15 minutes and per day). Refused with
      // TOO_MANY_REQUESTS before any lookup, so it says nothing about
      // whether the address has an account.
      await enforceRateLimitsInOrder(ctx.db, otpRequestLimits(getClientIp(ctx.headers), email));

      // The `otp` sign-in (src/auth.ts) accepts a code for an existing user,
      // or for an invitee whose invite /join has just validated: it creates
      // that user at verification time.
      const [user, pendingInvite] = await Promise.all([
        ctx.db.user.findUnique({
          where: { email },
          select: { id: true },
        }),
        ctx.db.pendingInviteValidation.findFirst({
          where: { email, expiresAt: { gt: new Date() } },
          select: { id: true },
        }),
      ]);

      // Silently succeed for anyone else: avoids email enumeration and stops
      // this endpoint from mailing codes that can never be accepted.
      if (!user && !pendingInvite) {
        return { sent: true, devCode: undefined };
      }

      if (isLocalDevelopment()) {
        await issueOtp(ctx.db, email, { code: DEV_OTP_CODE });
        return { sent: true, devCode: DEV_OTP_CODE };
      }

      const code = await issueOtp(ctx.db, email);

      // Sent after the response, and a failure is only logged: a slower or
      // failing reply for addresses that exist would reveal which ones do.
      runAfterResponse("send-otp-email", async () => {
        const { sendEmail } = await import("../../_lib/email");
        const { renderMobileOtpEmail } = await import("../../_lib/emails");
        const html = await renderMobileOtpEmail({ code });
        const emailResult = await sendEmail({ email, html, subject: `${code} is your ISO sign-in code` });
        if (emailResult.isErr) {
          logger.error("Error sending OTP email", { error: emailResult.error });
        }
      });

      return { sent: true, devCode: undefined };
    }),

  /**
   * Exchanges an emailed code for a mobile bearer token.
   *
   * Client contract (the tRPC counterpart of `code=rate_limited` on the web
   * sign-in, see src/auth.ts):
   * - TOO_MANY_REQUESTS: too many attempts from this client or for this
   *   address (15-minute or daily cap). The code was not looked at; a new
   *   code will not help until the window passes. Counted before any lookup,
   *   so it is the same for addresses with and without an account.
   * - UNAUTHORIZED: wrong, expired, used or attempt-exhausted code, or no
   *   such account; these are indistinguishable. Offer to send a new code.
   */
  verifyMobileOtp: publicProcedure
    .input(z.object({ email: emailInput, code: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email;

      await enforceRateLimitsInOrder(ctx.db, otpVerifyLimits(getClientIp(ctx.headers), email));

      const isValid = await verifyOtp(ctx.db, email, input.code);

      const user = await ctx.db.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (!isValid || !user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid or expired code.' });
      }

      const token = await signMobileToken(user.id);

      captureEvent(user.id, 'user_signed_in', { provider: 'email_otp', platform: 'ios' });

      return { token, userId: user.id };
    }),
});
