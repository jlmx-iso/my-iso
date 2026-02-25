import { TRPCError } from "@trpc/server";
import { SignJWT } from "jose";
import { z } from "zod";

import { UserVerificationErrors } from "~/_types/errors";
import { instagramHandleOptional, logger, phoneSchema, socialHandleOptional } from "~/_utils";
import { env } from "~/env";
import { createUser, createVerificationToken, verifyUserEmail } from "~/server/_db";
import { generateVerificationCode } from "~/server/_utils";
import { captureEvent } from "~/server/_lib/posthog";
import { createTRPCRouter, publicProcedure, } from "~/server/api/trpc";
import { checkRateLimit, RateLimits } from "~/server/_utils/rateLimit";


export const authRouter = createTRPCRouter({
  register: publicProcedure
    .input(z.object({
      companyName: z.string().min(1),
      email: z.string().email(),
      facebook: socialHandleOptional,
      firstName: z.string().min(1),
      instagram: instagramHandleOptional,
      lastName: z.string().min(1),
      location: z.string().min(1),
      phone: phoneSchema,
      provider: z.enum(["email", "google", "facebook"]),
      tiktok: socialHandleOptional,
      twitter: socialHandleOptional,
      vimeo: socialHandleOptional,
      website: z.string().trim().url().optional().or(z.literal("")),
      youtube: socialHandleOptional,
    }))
    .mutation(async ({ input }) => {
      const result = await createUser(input);
      if (result.isErr) {
        logger.error("Error registering user, throwing error", { error: result.error });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        });
      }
      const verificationTokenResult = await createVerificationToken({ identifier: result.value.id })
      if (verificationTokenResult.isErr) {
        logger.error("Error creating verification token", { error: verificationTokenResult.error });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: verificationTokenResult.error.message,
        });
      }

      const verificationUrl = new URL(`/verify/${verificationTokenResult.value}`, env.NEXT_PUBLIC_BASE_URL).toString();
      const { sendEmail } = await import("../../_lib/email");
      const emailResponse = await sendEmail({
        email: input.email,
        html: `
          <p>Thanks for registering!</p>
          <p>Please <a href="${verificationUrl}">verify your email address</a> to get started!</p>
          `,
        subject: "Almost done setting up your ISO account!",

      })
      if (emailResponse.isErr) {
        logger.error("Error sending email", { error: emailResponse.error });
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: emailResponse.error.message,
        });
      }
      logger.info("User registered successfully", { user: input });
      return "User registered successfully!";
    }),

  verifyAccount: publicProcedure
    .input(z.object({
      token: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const verificationResponse = await verifyUserEmail(input.token);
      if (verificationResponse.isErr) {
        switch (verificationResponse.error.message) {
          case UserVerificationErrors.TOKEN_NOT_FOUND:
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: "Invalid token",
            });
          case UserVerificationErrors.TOKEN_EXPIRED:
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: "Token expired",
            });
          case UserVerificationErrors.USER_NOT_FOUND:
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: "User not found",
            });
          case UserVerificationErrors.USER_ALREADY_VERIFIED:
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: "User already verified",
            });
          default:
            logger.error("Error verifying email", { error: verificationResponse.error });
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: verificationResponse.error.message,
            });
        }
      }
      return "Email verified successfully!";
    }),

  exchangeMobileToken: publicProcedure
    .input(z.object({
      idToken: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${input.idToken}`);
      if (!tokenInfoRes.ok) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid Google ID token' });
      }

      const tokenInfo = await tokenInfoRes.json() as {
        aud?: string;
        email?: string;
        given_name?: string;
        family_name?: string;
      };

      if (tokenInfo.aud !== env.GOOGLE_CLIENT_ID) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid Google ID token' });
      }

      if (!tokenInfo.email) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid Google ID token' });
      }

      const normalizedEmail = tokenInfo.email.toLowerCase();

      const user = await ctx.db.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No account found. Please sign up on the web first.' });
      }

      const secret = new TextEncoder().encode(env.AUTH_SECRET);
      const token = await new SignJWT({ sub: user.id, email: user.email })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);

      void captureEvent(user.id, 'user_signed_in', { provider: 'google', platform: 'ios' });

      return { token, userId: user.id };
    }),

  requestMobileOtp: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const normalizedEmail = input.email.toLowerCase();

      const rateLimitResult = await checkRateLimit(`otp:request:${normalizedEmail}`, RateLimits.AUTH);
      if (!rateLimitResult.allowed) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: `Too many attempts. Try again in ${rateLimitResult.retryAfter}s.` });
      }

      const user = await ctx.db.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });

      // Silently succeed if no account — avoids email enumeration
      if (!user) {
        return { sent: true, devCode: undefined };
      }

      // Delete any existing OTP tokens for this email to avoid stale codes
      await ctx.db.verificationToken.deleteMany({
        where: { identifier: `otp:${normalizedEmail}` },
      });

      const isDev = env.NODE_ENV === 'development';
      const code = isDev ? '000000' : generateVerificationCode();
      const expires = new Date(Date.now() + 1000 * 60 * 10); // 10 minutes

      await ctx.db.verificationToken.create({
        data: { identifier: `otp:${normalizedEmail}`, token: code, expires },
      });

      if (!isDev) {
        const { sendEmail } = await import("../../_lib/email");
        const { renderMobileOtpEmail } = await import("../../_lib/emails");
        const html = await renderMobileOtpEmail({ code });
        const emailResult = await sendEmail({ email: normalizedEmail, subject: `${code} is your ISO sign-in code`, html });

        if (emailResult.isErr) {
          logger.error("Error sending OTP email", { error: emailResult.error });
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send code. Please try again.' });
        }
      }

      return { sent: true, devCode: isDev ? code : undefined };
    }),

  verifyMobileOtp: publicProcedure
    .input(z.object({ email: z.string().email(), code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const normalizedEmail = input.email.toLowerCase();
      const identifier = `otp:${normalizedEmail}`;

      const rateLimitResult = await checkRateLimit(`otp:verify:${normalizedEmail}`, RateLimits.STRICT);
      if (!rateLimitResult.allowed) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: `Too many attempts. Try again in ${rateLimitResult.retryAfter}s.` });
      }

      const record = await ctx.db.verificationToken.findUnique({
        where: { identifier_token: { identifier, token: input.code } },
      });

      if (!record) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid code.' });
      }

      if (record.expires < new Date()) {
        await ctx.db.verificationToken.delete({ where: { identifier_token: { identifier, token: input.code } } });
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Code has expired. Please request a new one.' });
      }

      await ctx.db.verificationToken.delete({ where: { identifier_token: { identifier, token: input.code } } });

      const user = await ctx.db.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found.' });
      }

      const secret = new TextEncoder().encode(env.AUTH_SECRET);
      const token = await new SignJWT({ sub: user.id, email: user.email })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);

      void captureEvent(user.id, 'user_signed_in', { provider: 'email_otp', platform: 'ios' });

      return { token, userId: user.id };
    }),
});
