import NextAuth, {type DefaultSession} from "next-auth"

declare module "next-auth" {
  interface Session {
    user: DefaultUser & DefaultSession["user"]
  }

  interface DefaultUser {
    firstName: string
    lastName: string
    profilePic?: string
  }
}