import { PrismaAdapter } from "@next-auth/prisma-adapter";
import {
  type DefaultSession,
  getServerSession,
  type NextAuthOptions,
} from "next-auth";
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email"


import { env } from "~/env";
import { db } from "~/server/db";
import { checkIfUserExists } from "~/server/api/auth/auth";
import { logger } from "~/_utils";

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

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authOptions: NextAuthOptions = {
  callbacks: {
    session: async (props) => {
      console.log("session", props);
      return props.session;
    },
    jwt: async ({user, token}) => {
      if (user) {
        token.name = user.firstName;
        token.picture = user.profilePic;
      }
      return token;
    },
    signIn: async ({ user }) => {
      if (!user.email) {
        logger.info("No email provided");
        return false;
      }
      return await checkIfUserExists(user.email);
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
    EmailProvider({
      server: {
        host: env.EMAIL_SERVER_HOST,
        port: env.EMAIL_SERVER_PORT,
        auth: {
          user: env.EMAIL_SERVER_USER,
          pass: env.EMAIL_SERVER_PASSWORD,
        },
        from: env.EMAIL_FROM,
      },
      from: env.EMAIL_FROM,
    }),
    // CredentialsProvider({
    //   name: 'Credentials',
    //   id: 'credentials',
    //   credentials: {
    //     username: { label: "Username", type: "text" },
    //     password: {  label: "Password", type: "password" }
    //   },
    //   async authorize(credentials) {
    //     if(!credentials){
    //       return null;
    //     }
    //     const user = await authorizeUser(credentials);
    //     if (user) {
    //       logger.info("User authorized", user)
    //       return user;
    //     } else {
    //       logger.info("User not authorized")
    //       return null;
    //     }
    //   },
    // }),

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
  debug: env.NODE_ENV === "development",
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = () => getServerSession(authOptions);
