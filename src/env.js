import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
  */
  client: {

    NEXT_PUBLIC_GOOGLE_PLACES_API_KEY: z.string(),

    NEXT_PUBLIC_POSTHOG_HOST: z.string().url(),

    NEXT_PUBLIC_POSTHOG_PUBLIC_KEY: z.string(),
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: z.string(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string(),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  },




  /**
     * Makes it so that empty strings are treated as undefined.
     * `SOME_VAR: z.string()` and `SOME_VAR=''` will throw an error.
     */
  emptyStringAsUndefined: true,




  /**
     * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
     * middlewares) or client-side so we need to destruct manually.
     */
  runtimeEnv: {
    BASE_URL: process.env.BASE_URL,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    DATABASE_URL: process.env.DATABASE_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_SERVER_HOST: process.env.EMAIL_SERVER_HOST,
    EMAIL_SERVER_PASSWORD: process.env.EMAIL_SERVER_PASSWORD,
    EMAIL_SERVER_PORT: process.env.EMAIL_SERVER_PORT,
    EMAIL_SERVER_USER: process.env.EMAIL_SERVER_USER,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    NEXT_PUBLIC_GOOGLE_PLACES_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_POSTHOG_PUBLIC_KEY: process.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY,
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NODE_ENV: process.env.NODE_ENV,
    POSTMARK_API_TOKEN: process.env.POSTMARK_API_TOKEN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  },


  /**
     * Specify your server-side environment variables schema here. This way you can ensure the app
     * isn't built with invalid env vars.
     */
  server: {
    BASE_URL: z.string().url(),

    CLOUDINARY_API_KEY: z.string(),


    CLOUDINARY_API_SECRET: z.string(),


    CLOUDINARY_CLOUD_NAME: z.string(),


    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (str) => !str.includes("YOUR_MYSQL_URL_HERE"),
        "You forgot to change the default URL"
      ),

    EMAIL_FROM: z.string().email(),

    EMAIL_SERVER_HOST: z.string(),

    EMAIL_SERVER_PASSWORD: z.string(),

    EMAIL_SERVER_PORT: z.string(),

    EMAIL_SERVER_USER: z.string(),
    // Add ` on ID and SECRET if you want to make sure they're not empty
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    GOOGLE_PLACES_API_KEY: z.string(),
    NEXTAUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    NEXTAUTH_URL: z.preprocess(
      // This makes Vercel deployments not fail if you don't set NEXTAUTH_URL
      // Since NextAuth.js automatically uses the VERCEL_URL if present.
      (str) => process.env.VERCEL_URL ?? str,
      // VERCEL_URL doesn't include `https` so it cant be validated as a URL
      process.env.VERCEL ? z.string() : z.string().url()
    ),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    POSTMARK_API_TOKEN: z.string(),
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_WEBHOOK_SECRET: z.string(),
  },

  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
