import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";
import { DISTINCT_ID_COOKIE_NAME, FeatureFlags, type FlagsMatcher, getFeatureFlagVariant } from "~/app/_lib";

const flagsByPath: FlagsMatcher = {
  'app': {
    name: FeatureFlags.IS_APP_DISABLED,
    rewrite: (flagValue, urlPath) => (flagValue ? '/' : urlPath),
  },
};

const middleware = async (request: NextRequest) => {
  const url = new URL(request.nextUrl.href);
  const flag = flagsByPath[url.pathname.split('/')[1] ?? ''];

  if (!flag) {
    return NextResponse.next();
  }
  const distinctUserID = request.cookies.get(DISTINCT_ID_COOKIE_NAME)?.value ?? '0'
  const variantValue = await getFeatureFlagVariant(distinctUserID, flag.name)

  url.pathname = flag.rewrite(variantValue, url.pathname)
  return NextResponse.rewrite(url);
}

export default withAuth(middleware);

export const config = {
  matcher: ["/app/:path*"]
};