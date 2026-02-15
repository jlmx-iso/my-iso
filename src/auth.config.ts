import type { NextAuthConfig } from "next-auth";
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google";
import ResendProvider from "next-auth/providers/resend";
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
 * Shared provider configuration
 * Used by both main auth and edge middleware configs
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
  ...(env.RESEND_API_KEY
    ? [
        ResendProvider({
          from: env.EMAIL_FROM,
          apiKey: env.RESEND_API_KEY,
        }),
      ]
    : []),
];

/**
 * Edge-compatible auth configuration for middleware
 * This config doesn't include the adapter since middleware runs on the edge
 */
export default {
  providers,
  session: sessionConfig,
} satisfies NextAuthConfig;
