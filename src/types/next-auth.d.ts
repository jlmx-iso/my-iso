import { type DefaultSession } from "next-auth"


/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface DefaultUser {
    firstName: string
    lastName: string
    profilePic?: string
  }
  interface Session {
    user: DefaultUser & DefaultSession["user"]
  }

}