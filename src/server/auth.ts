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
import { checkIfUserExists } from "~/server/_utils";
import { logger } from "~/_utils";
import { type DefaultJWT } from "next-auth/jwt";
import { sendEmail } from "./_lib/postmark";

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
  interface Session extends DefaultSession {
    user: DefaultUser & DefaultSession["user"]
    id: string;
    accessToken: string;
  }

  interface JWT extends Record<string, unknown>, DefaultJWT {
    id: string;
    accessToken: string;
  }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authOptions: NextAuthOptions = {
  callbacks: {
    session: async ({ session, token }) => {
      session.accessToken = token.accessToken as string;
      session.user.id = token.id as string;
      return session;
    },
    jwt: async ({ account, user, token }) => {
      if (account) {
        token.accessToken = account.access_token;
      }
      if (user) {
        token.name = user.firstName;
        token.picture = user.profilePic;
        token.id = user.id;
      }
      return token;
    },
    signIn: async ({ user }) => {
      if (!user.email) {
        logger.info("No email provided");
        return false;
      }
      return await checkIfUserExists(user.email);
    },
    redirect: async ({ baseUrl }) => {
      return baseUrl;
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
      sendVerificationRequest: async ({ identifier: email, url, token, provider }) => {
        if (env.NODE_ENV === "development") {
          // eslint-disable-next-line no-console
          console.log("sendVerificationRequest", { email, url, token, provider });
        } else {
          await sendEmail({
            email,
            subject: "Sign in",
            html: `<p>Here is your sign in link: <a href="${url}">${url}</a></p>`,
          });
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
  debug: env.NODE_ENV === "development",
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = () => getServerSession(authOptions);
