import type { NextAuthConfig } from "next-auth";
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google";

import { isProductionDeployment, parseLoopbackOverride } from "~/_lib/loopbackOverride";
import { logger } from "~/_utils";
import { env } from "~/env";
import { captureServerException } from "~/server/_lib/posthog";
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
 * A refused or failed sign-in comes back to /login with Auth.js's error code
 * (`?error=AccessDenied`, `OAuthAccountNotLinked`, `Configuration`, ...) or
 * the app's own (`email_unverified`, `deletion_pending`), which the login
 * form explains. Without these, Auth.js sent people to its own unstyled
 * /api/auth/error and /api/auth/signin pages.
 */
export const pages = { error: "/login", signIn: "/login" };

/** Reports, once, a GOOGLE_OAUTH_ISSUER_URL found set in production. */
function reportIgnoredIssuerOverride(): void {
  const error = new Error("GOOGLE_OAUTH_ISSUER_URL ignored in production");
  logger.error(error.message);
  captureServerException(error, { source: "auth.config" });
}

/**
 * `GOOGLE_OAUTH_ISSUER_URL` points Google sign-in at a local OpenID provider
 * (the end-to-end stub, src/test/helpers/oidcStub.ts) instead of
 * accounts.google.com. TEST ONLY, with the rules of every such override
 * (~/_lib/loopbackOverride), except how production refuses it:
 *
 * - in a production deployment it is ignored (Google's own issuer is used)
 *   and reported. Throwing, as the Stripe override does when a client is
 *   built, would fail every page here: the middleware imports this module;
 * - elsewhere it must be a loopback URL, or this throws.
 *
 * Returns the issuer to use, or undefined for Google's own.
 */
export function googleIssuerOverride(
  value: string | undefined = env.GOOGLE_OAUTH_ISSUER_URL,
  production: boolean = isProductionDeployment({
    appEnv: env.APP_ENV,
    baseUrl: env.NEXT_PUBLIC_BASE_URL,
    isWorkerRuntime: isCloudflareRuntime(),
    nodeEnv: env.NODE_ENV,
    secretKey: env.STRIPE_SECRET_KEY,
  }),
  reportIgnored: () => void = reportIgnoredIssuerOverride,
): string | undefined {
  if (!value) return undefined;
  if (production) {
    reportIgnored();
    return undefined;
  }
  // The issuer must match the stand-in's own `iss` exactly, so the value is
  // used as given once it has passed the checks.
  parseLoopbackOverride("GOOGLE_OAUTH_ISSUER_URL", value, { production: false });
  return value;
}

/** What a Google ID token says about the person, as the app stores it. */
export function googleProfileToUser(profile: GoogleProfile) {
  return {
    email: profile.email,
    firstName: profile.given_name,
    id: profile.sub,
    lastName: profile.family_name ?? "",
  };
}

// Read once per module instance, so a stray value is reported once.
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
  pages,
  providers,
  session: sessionConfig,
} satisfies NextAuthConfig;
