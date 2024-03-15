import { PrismaAdapter } from "@next-auth/prisma-adapter";
import {
  getServerSession,
  type NextAuthOptions,
} from "next-auth";
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials"


import { env } from "~/env";
import { db } from "~/server/db";
import { authorizeUser } from "~/server/api/auth/auth";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
// declare module "next-auth" {
//   interface Session {
//     user: {
//       id: string;
//       firstName: string;
//       lastName: string;
//       email: string;
//     } & DefaultSession["user"];
//   }

//   // interface User {
//   //   firstName: string;
//   //   lastName: string;
//   // }
// }

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authOptions: NextAuthOptions = {
  callbacks: {
    session: ({ session, user }) => {
      console.log({ session, user });
      return {
        ...session,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          profilePic: user.profilePic,
        },
      };
    },
    jwt: async ({ token, user, account }) => {
      console.log(user);
      if (account) {
        token.id = account.id;
      }
      return token;
    },
    signIn: async () => {
      return true;
    }
  },
  adapter: PrismaAdapter(db),
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      profile: (profile: GoogleProfile) => {
        return {
          id: profile.sub,
          firstName: profile.given_name,
          lastName: profile.family_name,
          email: profile.email,
        };
      },
    }),
    CredentialsProvider({
      name: 'Credentials',
      id: 'credentials',
      credentials: {
        username: { label: "Username", type: "text" },
        password: {  label: "Password", type: "password" }
      },
      async authorize(credentials) {
        console.log(credentials);
        if(!credentials){
          return null;
        }
        const user = await authorizeUser(credentials);
        if (user) {
          return user;
        } else {
          return null;
        }
      },
    }),

    /**
     * ...add more providers here.
     *
     * Most other providers require a bit more work than the Google provider. For example, the
     * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
     * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
     *
     * @see https://next-auth.js.org/providers/github
     */
  ],
  secret: env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 }, // 24 hours
  jwt: { 
    secret: env.NEXTAUTH_SECRET,
    maxAge: 24 * 60 * 60 * 30, // 30 days
  },
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = () => getServerSession(authOptions);
