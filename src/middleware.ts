import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";
import NextAuth, { type NextAuthRequest } from "next-auth";

import {
  type ContentSecurityPolicyOptions,
  nextWithContentSecurityPolicy,
} from "~/_lib/contentSecurityPolicy";
import authConfig from "~/auth.config";
import { env } from "~/env";

// Next.js 16 deprecates the `middleware` file convention in favour of
// `proxy`, but `proxy` always runs on the Node.js runtime, and
// @opennextjs/cloudflare (1.20) only supports Node.js middleware
// experimentally ("not officially maintained ... use at your own risk").
// Keep this file as an edge middleware until that support is stable.
const { auth } = NextAuth(authConfig);

/** Read per request: CSP_MODE is a runtime variable (the kill switch). */
function cspOptions(): ContentSecurityPolicyOptions {
  return {
    baseUrl: env.NEXT_PUBLIC_BASE_URL,
    isDevelopment: env.NODE_ENV === "development",
    mode: env.CSP_MODE,
  };
}

/**
 * Everything under /app requires a session. Anonymous visitors are sent to
 * /login, which brings them back to the page they asked for.
 */
// Typed with the event so the middleware overload of `auth` is chosen.
const requireSession = auth((request: NextAuthRequest, _event: NextFetchEvent) => {
  if (request.auth) return nextWithContentSecurityPolicy(request, cspOptions());

  const { pathname, search } = request.nextUrl;
  const loginUrl = new URL("/login", request.nextUrl);
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
});

/** Every page gets the Content-Security-Policy with a fresh nonce. */
export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    return requireSession(request, event);
  }
  return nextWithContentSecurityPolicy(request, cspOptions());
}

export const config = {
  // Pages only: not API routes, Next.js assets, the telemetry proxy or the
  // files in public/ (served by the asset store, or the Worker entry).
  matcher: [
    "/((?!api/|_next/|lens(?:/|$)|img/|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|llms\\.txt$).*)",
  ],
};
