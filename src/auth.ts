import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { env } from "~/env";
import { db } from "~/server/db";
import { checkIfUserExists } from "~/server/_utils/auth/auth";
import { logger } from "~/_utils";
import { providers, sessionConfig } from "~/auth.config";

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
  providers,
  callbacks: {
    jwt: async ({ account, user, token }) => {
      if (account) {
        token.accessToken = account.access_token;
      }
      if (user) {
        token.name = user.firstName;
        token.picture = user.profilePic;
        token.id = user.id;
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

      return session;
    },
    signIn: async ({ user, account }) => {
      if (!user.email) {
        logger.info("No email provided");
        return false;
      }
      // OAuth providers: allow sign-in (PrismaAdapter auto-creates user on first login)
      if (account?.provider === "google") return true;
      // Email magic link: only allow existing registered users
      return await checkIfUserExists(user.email);
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
