import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import ResendProvider from "next-auth/providers/resend";
import type { PendingInviteValidation } from "@prisma/client";

import { logger } from "~/_utils";
import { FeatureFlags, getFeatureFlagVariant } from "~/app/_lib/posthog";
import { providers, sessionConfig } from "~/auth.config";
import { env } from "~/env";
import { db } from "~/server/db";
import { checkIfUserExists } from "~/server/_utils/auth/auth";
import { generateUniqueInviteCode } from "~/server/_utils/invite";
import { USER_ROLES, WAITLIST_APPROVED_CODE } from "~/server/_utils/roles";

/**
 * Shared invite redemption logic used by both the OTP credential provider
 * and the createUser event (Google OAuth).
 */
async function redeemInviteAndSetupUser(
  database: typeof db,
  userId: string,
  pending: PendingInviteValidation,
  firstName: string,
): Promise<void> {
  const newCode = await generateUniqueInviteCode(
    firstName || "USER",
    async (c) => {
      const exists = await database.inviteCode.findUnique({ where: { code: c } });
      return exists !== null;
    },
  );

  if (pending.code === WAITLIST_APPROVED_CODE) {
    await database.$transaction([
      database.user.update({
        where: { id: userId },
        data: { role: USER_ROLES.FOUNDING_MEMBER },
      }),
      database.inviteCode.create({
        data: { code: newCode, creator: { connect: { id: userId } } },
      }),
      database.pendingInviteValidation.delete({ where: { id: pending.id } }),
    ]);
    return;
  }

  await database.$transaction(async (tx) => {
    const inviteCode = await tx.inviteCode.findUnique({
      where: { code: pending.code },
    });

    if (!inviteCode || inviteCode.currentRedemptions >= inviteCode.maxRedemptions) {
      if (!inviteCode) {
        logger.warn("Invite code no longer exists during redemption", { code: pending.code, userId });
      } else {
        logger.warn("Invite code at capacity during redemption", { code: pending.code, userId });
      }
      await tx.user.update({ where: { id: userId }, data: { role: USER_ROLES.FOUNDING_MEMBER } });
      await tx.inviteCode.create({ data: { code: newCode, creator: { connect: { id: userId } } } });
      await tx.pendingInviteValidation.delete({ where: { id: pending.id } });
      return;
    }

    await tx.inviteCode.update({
      where: { id: inviteCode.id },
      data: { currentRedemptions: { increment: 1 } },
    });
    await tx.inviteRedemption.create({
      data: {
        inviteCode: { connect: { id: inviteCode.id } },
        redeemedBy: { connect: { id: userId } },
      },
    });
    await tx.user.update({
      where: { id: userId },
      data: { role: USER_ROLES.FOUNDING_MEMBER, invitedByUserId: inviteCode.creatorId },
    });
    await tx.inviteCode.create({
      data: { code: newCode, creator: { connect: { id: userId } } },
    });
    await tx.pendingInviteValidation.delete({ where: { id: pending.id } });
  });
}

/**
 * Auth.js v5 configuration
 * Uses PrismaAdapter which works with both LibSQL (local) and D1 (Cloudflare)
 *
 * Note: EmailProvider removed as it's not edge-compatible (uses nodemailer)
 * Email-based authentication is handled via the custom auth router
 * See: src/server/api/routers/auth.ts for magic link implementation
 */
export const authConfig = {
  adapter: PrismaAdapter(db) as Adapter,
  providers: [
    ...providers,
    ...(env.RESEND_API_KEY
      ? [ResendProvider({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })]
      : []),
    CredentialsProvider({
      id: "otp",
      name: "Email OTP",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials) {
        const email = (credentials.email as string)?.toLowerCase();
        const code = credentials.code as string;
        if (!email || !code) return null;

        const identifier = `otp:${email}`;
        const record = await db.verificationToken.findUnique({
          where: { identifier_token: { identifier, token: code } },
        });

        if (!record || record.expires < new Date()) {
          if (record) {
            await db.verificationToken.delete({
              where: { identifier_token: { identifier, token: code } },
            });
          }
          return null;
        }

        await db.verificationToken.delete({
          where: { identifier_token: { identifier, token: code } },
        });

        let user = await db.user.findUnique({ where: { email } });

        // For new sign-ups via invite code: create user and redeem invite
        if (!user) {
          const pending = await db.pendingInviteValidation.findFirst({
            where: { email, expiresAt: { gt: new Date() } },
          });
          if (!pending) return null;

          user = await db.user.create({
            data: {
              email,
              emailVerified: new Date(),
              firstName: "",
              lastName: "",
              role: USER_ROLES.FOUNDING_MEMBER,
            },
          });

          await redeemInviteAndSetupUser(db, user.id, pending, "USER");
        }

        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profilePic: user.profilePic,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ account, user, token, trigger }) => {
      if (account) {
        token.accessToken = account.access_token;
      }
      if (user) {
        token.id = user.id;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.profilePic = user.profilePic;
        // Build display name: prefer firstName+lastName, fall back to Google name
        const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
        token.name = fullName || user.name;
        token.picture = user.profilePic ?? user.image;
      }
      // Refresh user data from DB on session update or if token is missing profile fields
      // (handles JWTs minted before this code was deployed)
      const needsBackfill = typeof token.id === "string" && !token.firstName;
      if ((trigger === "update" || needsBackfill) && typeof token.id === "string") {
        const freshUser = await db.user.findUnique({
          where: { id: token.id },
          select: { firstName: true, lastName: true, profilePic: true },
        });
        if (freshUser) {
          token.firstName = freshUser.firstName;
          token.lastName = freshUser.lastName;
          token.profilePic = freshUser.profilePic;
          const refreshedName = `${freshUser.firstName ?? ""} ${freshUser.lastName ?? ""}`.trim();
          token.name = refreshedName || token.name;
          token.picture = freshUser.profilePic;
        }
      }
      return token;
    },
    session: async ({ session, token }) => {
      // Safely assign accessToken with validation
      if (typeof token.accessToken === 'string') {
        session.accessToken = token.accessToken;
      } else if (token.accessToken !== undefined) {
        logger.warn("Invalid accessToken type in JWT", {
          type: typeof token.accessToken,
        });
      }

      // Safely assign user ID with validation
      if (typeof token.id === 'string') {
        session.user.id = token.id;
      } else {
        logger.error("Invalid or missing user ID in JWT token", {
          type: typeof token.id,
        });
        throw new Error("Invalid session: missing user ID");
      }

      // Map user profile fields from JWT to session
      session.user.name = typeof token.name === "string" ? token.name : undefined;
      session.user.firstName = typeof token.firstName === "string" ? token.firstName : "";
      session.user.lastName = typeof token.lastName === "string" ? token.lastName : "";
      session.user.profilePic = typeof token.profilePic === "string" ? token.profilePic : undefined;
      session.user.image = typeof token.picture === "string" ? token.picture : undefined;

      return session;
    },
    signIn: async ({ user, account }) => {
      if (!user.email) {
        logger.info("No email provided");
        return false;
      }

      const normalizedEmail = user.email.toLowerCase();

      // Existing users always pass
      const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
      if (existing) return true;

      // Check if invite-only mode is disabled via PostHog feature flag
      let inviteOnly: boolean | string | undefined;
      try {
        inviteOnly = await getFeatureFlagVariant(normalizedEmail, FeatureFlags.INVITE_ONLY);
      } catch (error) {
        // Fail-closed: if PostHog is unavailable, keep invite-only enforced
        logger.warn("Failed to fetch invite-only feature flag, defaulting to invite-only", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
        inviteOnly = true;
      }

      // If invite-only is explicitly false, allow new users through (open registration)
      if (inviteOnly === false) {
        return true;
      }

      // New users: require a PendingInviteValidation regardless of provider
      const pending = await db.pendingInviteValidation.findFirst({
        where: { email: normalizedEmail, expiresAt: { gt: new Date() } },
      });

      if (!pending) {
        // Google: redirect with a user-visible error; Resend: silently block
        return account?.provider === "google" ? "/join?error=invite_required" : false;
      }

      return true;
    },
  },
  events: {
    /**
     * Fires when PrismaAdapter creates a new user (first OAuth login).
     * Auto-redeems the invite code and generates an InviteCode for the new user.
     */
    createUser: async ({ user }) => {
      if (!user.email || !user.id) return;

      const normalizedEmail = user.email.toLowerCase();

      const pending = await db.pendingInviteValidation.findFirst({
        where: { email: normalizedEmail, expiresAt: { gt: new Date() } },
      });

      if (!pending) return;

      // PrismaAdapter maps Google's `given_name` → firstName, but fall back to
      // parsing the full `name` (which Google always provides) if firstName is empty.
      let firstName = (user as { firstName?: string }).firstName;
      if (!firstName && user.name) {
        firstName = user.name.split(" ")[0];
      }

      await redeemInviteAndSetupUser(db, user.id, pending, firstName ?? "USER");
    },
  },
  session: sessionConfig,
  debug: env.NODE_ENV === "development",
} satisfies NextAuthConfig;

/**
 * Main NextAuth instance
 * Export handlers for API routes and auth() for server-side session access
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
