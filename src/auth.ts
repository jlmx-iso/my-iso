import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { CredentialsSignin } from "next-auth";
import type { NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import CredentialsProvider from "next-auth/providers/credentials";
import ResendProvider from "next-auth/providers/resend";

import { logger } from "~/_utils";
import { FeatureFlags, getFeatureFlagVariant } from "~/app/_lib/posthog";
import { providers, sessionConfig } from "~/auth.config";
import { env } from "~/env";
import { isInviteRedeemable } from "~/server/_db/invite";
import { createInvitedUser, findPendingInvite, signInWithOtp } from "~/server/_lib/signup";
import { getClientIp } from "~/server/_utils/clientIp";
import { hashEmail } from "~/server/_utils/hash";
import { db } from "~/server/db";

/** Surfaces as `?error=CredentialsSignin&code=rate_limited`. */
class OtpRateLimited extends CredentialsSignin {
  code = "rate_limited";
}

/**
 * Whether new accounts currently need an invite (PostHog feature flag).
 * Fail-closed: if the flag cannot be fetched, invites stay required.
 */
async function isInviteOnly(email: string): Promise<boolean> {
  try {
    // PostHog gets a keyed hash, never the address itself.
    const distinctId = await hashEmail(email);
    return (await getFeatureFlagVariant(distinctId, FeatureFlags.INVITE_ONLY)) !== false;
  } catch (error) {
    logger.warn("Failed to fetch invite-only feature flag, defaulting to invite-only", { error });
    return true;
  }
}

const prismaAdapter = PrismaAdapter(db);

/**
 * PrismaAdapter with sign-up routed through `createInvitedUser`. Auth.js
 * swallows errors thrown from `events.createUser`, so the invite cannot be
 * enforced there; an error thrown from the adapter does abort the sign-in.
 */
const adapter: Adapter = {
  ...prismaAdapter,
  createUser: async (data) => {
    const firstName = data.firstName || data.name?.split(" ")[0] || "";
    const user = await createInvitedUser(
      db,
      {
        email: data.email.toLowerCase(),
        emailVerified: data.emailVerified,
        firstName,
        lastName: data.lastName ?? "",
      },
      isInviteOnly,
    );
    if (!user) throw new Error("Sign-up requires a valid invite");
    return user;
  },
};

/**
 * Auth.js v5 configuration
 * Uses PrismaAdapter which works with both LibSQL (local) and D1 (Cloudflare)
 */
export const authConfig = {
  adapter,
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
      /**
       * Email-code sign-in (POST /api/auth/callback/otp): rate limited,
       * attempt-capped and invite-enforcing, see signInWithOtp.
       */
      async authorize(credentials, request) {
        const result = await signInWithOtp(
          db,
          credentials,
          getClientIp(request.headers),
          isInviteOnly,
        );
        if (result.status === "rate_limited") throw new OtpRateLimited();
        if (result.status !== "ok") return null;
        const { user } = result;

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
    jwt: async ({ user, token, trigger }) => {
      // The provider's OAuth tokens are never copied into the session JWT.
      // Drop the one that sessions minted before this change still carry.
      delete token.accessToken;
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
      const needsBackfill = typeof token.id === "string" && token.firstName === undefined;
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

      // Open registration (invite-only switched off): anyone may sign up.
      if (!(await isInviteOnly(normalizedEmail))) return true;

      // Invite-only: /join must have validated a code for this address (or
      // the waitlist approved it), and that code must still have a slot.
      // This turns people away before an account is attempted; the binding,
      // race-free check is the atomic claim in createInvitedUser.
      const pending = await findPendingInvite(db, normalizedEmail);
      if (!pending || !(await isInviteRedeemable(db, pending.code))) {
        // Google: redirect with a user-visible error; Resend: silently block
        return account?.provider === "google" ? "/join?error=invite_required" : false;
      }

      return true;
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
