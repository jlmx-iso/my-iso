import NextAuth, { type PagesOptions } from "next-auth";

import { authOptions } from "~/server/auth";

// const pages: Partial<PagesOptions> = {
//   signIn: "/auth/login",
//   signOut: "/logout",
//   error: "/auth/error",
//   verifyRequest: "/verify",
//   newUser: "/",
// };

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const handler = NextAuth({...authOptions});
export { handler as GET, handler as POST };
