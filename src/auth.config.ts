import type { NextAuthConfig } from "next-auth";
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google";

import { isProductionDeployment, parseLoopbackOverride } from "~/_lib/loopbackOverride";
import { env } from "~/env";
import { isCloudflareRuntime } from "~/server/_utils/clientIp";

/**
 * Shared session configuration for Auth.js v5
 * JWT strategy required for edge runtime compatibility
 */
export const sessionConfig = {
  strategy: "jwt" as const,
  maxAge: 24 * 60 * 60, // 24 hours
};

/**
 * `GOOGLE_OAUTH_ISSUER_URL` points Google sign-in at a local OpenID provider
 * (the end-to-end stub, src/test/helpers/oidcStub.ts) instead of
 * accounts.google.com. TEST ONLY, with the rules of every such override
 * (~/_lib/loopbackOverride): a loopback address or nothing, and refused
 * outright, by throwing, in a production deployment. Returns the issuer to
 * use, or undefined for Google's own.
 */
export function googleIssuerOverride(
  value: string | undefined = env.GOOGLE_OAUTH_ISSUER_URL,
  production: boolean = isProductionDeployment({
    baseUrl: env.NEXT_PUBLIC_BASE_URL,
    isWorkerRuntime: isCloudflareRuntime(),
    nodeEnv: env.NODE_ENV,
    secretKey: env.STRIPE_SECRET_KEY,
  }),
): string | undefined {
  // The issuer must match the stand-in's own `iss` exactly, so the value is
  // used as given once it has passed the checks.
  return parseLoopbackOverride("GOOGLE_OAUTH_ISSUER_URL", value, { production }) ? value : undefined;
}

/** What a Google ID token says about the person, as the app stores it. */
export function googleProfileToUser(profile: GoogleProfile) {
  return {
    email: profile.email,
    firstName: profile.given_name,
    id: profile.sub,
    lastName: profile.family_name ?? "",
    emailVerified: profile.email_verified ? new Date() : null,
  };
}

const googleIssuer = googleIssuerOverride();

/**
 * Edge-compatible providers (no adapter required). auth.ts adds the `otp`
 * credentials provider, which needs the database.
 */
export const providers = [
  GoogleProvider({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    ...(googleIssuer ? { issuer: googleIssuer } : {}),
    profile: googleProfileToUser,
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
