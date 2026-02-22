import { type NextRequest, NextResponse } from "next/server";
import NextAuth from "next-auth";

import authConfig from "~/auth.config";
import { DISTINCT_ID_COOKIE_NAME, FeatureFlags, type FlagsMatcher, getFeatureFlagVariant } from "~/app/_lib";

const flagsByPath: FlagsMatcher = {
  'app': {
    name: FeatureFlags.IS_APP_DISABLED,
    rewrite: (flagValue, urlPath) => (flagValue ? '/' : urlPath),
  },
};

/**
 * Auth.js v5 proxy wrapper (Next.js 16+)
 * Combines authentication check with feature flag logic
 *
 * Note: Migrated from middleware.ts to proxy.ts for Next.js 16 compatibility
 */
const { auth } = NextAuth(authConfig);

export default auth(async (request) => {
  const url = new URL(request.nextUrl.href);
  const flag = flagsByPath[url.pathname.split('/')[1] ?? ''];

  if (!flag) {
    return NextResponse.next();
  }

  // Authenticated users bypass feature flag gating
  // The IS_APP_DISABLED flag is intended for public/unauthenticated access control
  if (request.auth?.user) {
    return NextResponse.next();
  }

  // Get or generate distinct user ID for feature flags
  let distinctUserID = request.cookies.get(DISTINCT_ID_COOKIE_NAME)?.value;
  let response = NextResponse.next();

  if (!distinctUserID) {
    // Generate a new distinct ID if cookie doesn't exist
    distinctUserID = crypto.randomUUID();
    response.cookies.set(DISTINCT_ID_COOKIE_NAME, distinctUserID, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  }

  try {
    const variantValue = await getFeatureFlagVariant(distinctUserID, flag.name);
    url.pathname = flag.rewrite(variantValue, url.pathname);
    return NextResponse.rewrite(url);
  } catch (error) {
    // FAIL-OPEN STRATEGY: If feature flag fetch fails, allow request to proceed
    // This prevents feature flag service outages from breaking the entire application
    // Errors are logged for monitoring - consider adding alerting for repeated failures
    //
    // Note: Can't use structured logger in proxy (edge runtime constraint)
    // Using console.error which works in Cloudflare Workers
    console.error('[PROXY] Feature flag error:', error);

    // TODO: Add monitoring/alerting for repeated feature flag failures
    // Consider: Send to error tracking service (Sentry) in production

    return response;
  }
});

export const config = {
  matcher: ["/app/:path*"]
};
