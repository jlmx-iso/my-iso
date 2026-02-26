import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
  */
  client: {

    NEXT_PUBLIC_BASE_URL: z.string().url(),

    NEXT_PUBLIC_GOOGLE_PLACES_API_KEY: z.string(),

    NEXT_PUBLIC_POSTHOG_HOST: z.string().url(),

    NEXT_PUBLIC_POSTHOG_PUBLIC_KEY: z.string(),
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: z.string(),
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
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL ?? process.env.BASE_URL,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    DATABASE_URL: process.env.DATABASE_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    NEXT_PUBLIC_GOOGLE_PLACES_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_POSTHOG_PUBLIC_KEY: process.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY,
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    NODE_ENV: process.env.NODE_ENV,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    STRIPE_FOUNDING_ANNUAL_PRICE_ID: process.env.STRIPE_FOUNDING_ANNUAL_PRICE_ID,
    STRIPE_FOUNDING_MONTHLY_PRICE_ID: process.env.STRIPE_FOUNDING_MONTHLY_PRICE_ID,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_STANDARD_ANNUAL_PRICE_ID: process.env.STRIPE_STANDARD_ANNUAL_PRICE_ID,
    STRIPE_STANDARD_MONTHLY_PRICE_ID: process.env.STRIPE_STANDARD_MONTHLY_PRICE_ID,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    KEY_WRAPPING_SECRET: process.env.KEY_WRAPPING_SECRET,
  },


  /**
     * Specify your server-side environment variables schema here. This way you can ensure the app
     * isn't built with invalid env vars.
     */
  server: {
    CLOUDINARY_API_KEY: z.string(),


    CLOUDINARY_API_SECRET: z.string(),


    CLOUDINARY_CLOUD_NAME: z.string(),


    // DATABASE_URL is optional when using D1 on Cloudflare
    // Required for local development with LibSQL
    DATABASE_URL: z
      .string()
      .url()
      .optional()
      .refine(
        (str) => !str || !str.includes("YOUR_MYSQL_URL_HERE"),
        "You forgot to change the default URL"
      ),

    EMAIL_FROM: z.string().email(),

    // Add ` on ID and SECRET if you want to make sure they're not empty
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    GOOGLE_PLACES_API_KEY: z.string(),
    // Auth.js v5 requires AUTH_SECRET for JWT encryption
    // CRITICAL: Must be at least 32 characters for security
    // Generate with: openssl rand -base64 32
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters for security"),
    AUTH_URL: z.string().url().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    ANTHROPIC_API_KEY: z.string().optional(), // Optional — AI features degrade gracefully
    RESEND_API_KEY: z.string().optional(), // Make optional until API key is obtained
    STRIPE_FOUNDING_ANNUAL_PRICE_ID: z.string().optional(),
    STRIPE_FOUNDING_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_STANDARD_ANNUAL_PRICE_ID: z.string().optional(),
    STRIPE_STANDARD_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string(),
    KEY_WRAPPING_SECRET: z.string().min(64, "KEY_WRAPPING_SECRET must be a 32-byte hex string (64 hex characters)").regex(/^[0-9a-fA-F]+$/, "KEY_WRAPPING_SECRET must be a hex string"),
  },

  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
