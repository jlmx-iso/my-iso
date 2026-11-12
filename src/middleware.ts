import { NextResponse } from "next/server";
import NextAuth from "next-auth";

import authConfig from "~/auth.config";

// Next.js 16 deprecates the `middleware` file convention in favour of
// `proxy`, but `proxy` always runs on the Node.js runtime, and
// @opennextjs/cloudflare (1.20) only supports Node.js middleware
// experimentally ("not officially maintained ... use at your own risk").
// Keep this file as an edge middleware until that support is stable.
const { auth } = NextAuth(authConfig);

/**
 * Everything under /app requires a session. Anonymous visitors are sent to
 * /login, which brings them back to the page they asked for.
 */
export default auth((request) => {
  if (request.auth) return;

  const { pathname, search } = request.nextUrl;
  const loginUrl = new URL("/login", request.nextUrl);
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  matcher: ["/app/:path*"]
};
