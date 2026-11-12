import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Every variable the app reads. docs/DEPLOYMENT.md says what each one is for
// and where it is set; .env.example and .dev.vars.example must list exactly
// these names (src/env.test.ts fails when they drift).
//
// `NEXT_PUBLIC_*` values are inlined into the JavaScript at build time, so
// staging and production are separate builds. Everything else is read at
// runtime (wrangler.toml `[vars]`, `wrangler secret put`, or `.env` locally).

const appEnvironment = z.enum(["production", "staging", "development"]);

export const env = createEnv({
  /** Build-time, visible to the browser. */
  client: {
    // Which deployment this build is for; tags analytics events.
    NEXT_PUBLIC_APP_ENV: appEnvironment.default("development"),
    // The app's public origin: the one source of truth for absolute URLs.
    NEXT_PUBLIC_BASE_URL: z.string().url(),
    NEXT_PUBLIC_GOOGLE_PLACES_API_KEY: z.string(),
    // PostHog project token (phc_...). Analytics are off without it.
    NEXT_PUBLIC_POSTHOG_PUBLIC_KEY: z.string().optional(),
    // The PostHog app, for links the SDK builds. Defaults to US Cloud.
    NEXT_PUBLIC_POSTHOG_UI_HOST: z.string().url().optional(),
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: z.string(),
    // Address shown to people who need help.
    NEXT_PUBLIC_SUPPORT_EMAIL: z.string().email().optional(),
  },

  /** Empty strings are treated as undefined. */
  emptyStringAsUndefined: true,

  /**
   * `process.env` cannot be destructured in the edge runtime or the browser,
   * so every variable is listed by hand.
   */
  runtimeEnv: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    APP_ENV: process.env.APP_ENV,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    DATABASE_URL: process.env.DATABASE_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NEXT_PUBLIC_GOOGLE_PLACES_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY,
    NEXT_PUBLIC_POSTHOG_PUBLIC_KEY: process.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY,
    NEXT_PUBLIC_POSTHOG_UI_HOST: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY,
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    NODE_ENV: process.env.NODE_ENV,
    POSTHOG_ASSETS_HOST: process.env.POSTHOG_ASSETS_HOST,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    STRIPE_FOUNDING_ANNUAL_PRICE_ID: process.env.STRIPE_FOUNDING_ANNUAL_PRICE_ID,
    STRIPE_FOUNDING_MONTHLY_PRICE_ID: process.env.STRIPE_FOUNDING_MONTHLY_PRICE_ID,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_STANDARD_ANNUAL_PRICE_ID: process.env.STRIPE_STANDARD_ANNUAL_PRICE_ID,
    STRIPE_STANDARD_MONTHLY_PRICE_ID: process.env.STRIPE_STANDARD_MONTHLY_PRICE_ID,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  },

  /** Runtime, server only. */
  server: {
    // Optional: without a key the AI features switch themselves off.
    ANTHROPIC_API_KEY: z.string().optional(),
    // Override the Anthropic API origin (local stubs, gateways).
    ANTHROPIC_BASE_URL: z.string().url().optional(),
    // Override the Claude model used for match summaries and icebreakers.
    // A Claude model id such as claude-haiku-5-5, nothing else.
    ANTHROPIC_MODEL: z
      .string()
      .regex(/^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/, "ANTHROPIC_MODEL must be a Claude model id")
      .optional(),
    // Which deployment is running (wrangler.toml sets it per environment).
    APP_ENV: appEnvironment.default("development"),
    // Signs session JWTs. Generate with: openssl rand -base64 32
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters for security"),
    AUTH_URL: z.string().url().optional(),
    CLOUDINARY_API_KEY: z.string(),
    CLOUDINARY_API_SECRET: z.string(),
    CLOUDINARY_CLOUD_NAME: z.string(),
    // Local SQLite file for `next dev`. Unused on Cloudflare (D1 binding).
    DATABASE_URL: z.string().url().optional(),
    // Sender of every transactional email.
    EMAIL_FROM: z.string().email(),
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    GOOGLE_PLACES_API_KEY: z.string(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // PostHog ingestion and assets origins. Default to US Cloud.
    POSTHOG_ASSETS_HOST: z.string().url().optional(),
    POSTHOG_HOST: z.string().url().optional(),
    // Optional: without a key no email is sent.
    RESEND_API_KEY: z.string().optional(),
    STRIPE_FOUNDING_ANNUAL_PRICE_ID: z.string().optional(),
    STRIPE_FOUNDING_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_STANDARD_ANNUAL_PRICE_ID: z.string().optional(),
    STRIPE_STANDARD_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string(),
  },

  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
