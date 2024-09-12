import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { sendEmail } from "../../_lib/postmark";

import { UserVerificationErrors } from "~/_types/errors";
import { logger } from "~/_utils";
import { env } from "~/env";
import { createUser, createVerificationToken, verifyUserEmail } from "~/server/_db";
import { createTRPCRouter, publicProcedure, } from "~/server/api/trpc";


export const authRouter = createTRPCRouter({
  register: publicProcedure
    .input(z.object({
      companyName: z.string().min(1),
      email: z.string().min(1),
      facebook: z.string().trim().url().optional().or(z.literal("")),
      firstName: z.string().min(1),
      instagram: z.string().trim().url().optional().or(z.literal("")),
      lastName: z.string().min(1),
      location: z.string().min(1),
      phone: z.string().min(1),
      provider: z.enum(["email", "google", "facebook"]),
      tiktok: z.string().trim().url().optional().or(z.literal("")),
      twitter: z.string().trim().url().optional().or(z.literal("")),
      vimeo: z.string().trim().url().optional().or(z.literal("")),
      website: z.string().trim().url().optional().or(z.literal("")),
      youtube: z.string().trim().url().optional().or(z.literal("")),
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

      const verificationUrl = new URL(`/verify/${verificationTokenResult.value}`, env.BASE_URL).toString();
      const emailResponse = await sendEmail({
        email: input.email,
        html: `
          <p>Thanks for registering!</p>
          <p>Please <a href=${verificationUrl}>verify your email address</a> to get started!</p>
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
});