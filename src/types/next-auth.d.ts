import { type DefaultSession } from "next-auth";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface User {
    firstName: string;
    lastName: string;
    profilePic?: string | null;
  }

  interface Session {
    user: {
      id: string;
      firstName: string;
      lastName: string;
      profilePic?: string;
    } & DefaultSession["user"];
  }
}

// What the session JWT holds (see the jwt callback in src/auth.ts). Every
// field is optional: a token minted before a field existed lacks it, and
// readers check (the session callback refuses a token without an id).
declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    firstName?: string;
    lastName?: string;
    profilePic?: string | null;
  }
}