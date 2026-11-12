import NextAuth from "next-auth";

import authConfig from "~/auth.config";

// Next.js 16 deprecates the `middleware` file convention in favour of
// `proxy`, but `proxy` always runs on the Node.js runtime, and
// @opennextjs/cloudflare (1.20) only supports Node.js middleware
// experimentally ("not officially maintained ... use at your own risk").
// Keep this file as an edge middleware until that support is stable.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: ["/app/:path*"]
};
