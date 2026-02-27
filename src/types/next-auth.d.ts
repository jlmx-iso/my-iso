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
    accessToken: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    accessToken?: string;
    firstName?: string;
    lastName?: string;
    profilePic?: string;
  }
}