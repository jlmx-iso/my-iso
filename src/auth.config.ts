import type { NextAuthConfig } from "next-auth";
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google";
import { env } from "~/env";

/**
 * Shared session configuration for Auth.js v5
 * JWT strategy required for edge runtime compatibility
 */
export const sessionConfig = {
  strategy: "jwt" as const,
  maxAge: 24 * 60 * 60, // 24 hours
};

/**
 * Edge-compatible providers (no adapter required).
 * Resend/email provider is excluded here — it needs a DB adapter
 * and is added only in auth.ts where PrismaAdapter is configured.
 */
export const providers = [
  GoogleProvider({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    profile: (profile: GoogleProfile) => ({
      email: profile.email,
      firstName: profile.given_name,
      id: profile.sub,
      lastName: profile.family_name ?? "",
      emailVerified: profile.email_verified ? new Date() : null,
    }),
  }),
];

/**
 * Edge-compatible auth configuration for middleware
 * This config doesn't include the adapter since middleware runs on the edge
 */
export default {
  providers,
  session: sessionConfig,
} satisfies NextAuthConfig;
