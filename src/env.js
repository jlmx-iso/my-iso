import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { AI_MODELS } from "./aiModels.js";

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
    STRIPE_API_BASE_URL: process.env.STRIPE_API_BASE_URL,
    STRIPE_FOUNDING_ANNUAL_PRICE_ID: process.env.STRIPE_FOUNDING_ANNUAL_PRICE_ID,
    STRIPE_FOUNDING_MONTHLY_PRICE_ID: process.env.STRIPE_FOUNDING_MONTHLY_PRICE_ID,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_STANDARD_ANNUAL_PRICE_ID: process.env.STRIPE_STANDARD_ANNUAL_PRICE_ID,
    STRIPE_STANDARD_MONTHLY_PRICE_ID: process.env.STRIPE_STANDARD_MONTHLY_PRICE_ID,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    SUPPORT_INBOX_EMAIL: process.env.SUPPORT_INBOX_EMAIL,
  },

  /** Runtime, server only. */
  server: {
    // Optional: without a key the AI features switch themselves off.
    ANTHROPIC_API_KEY: z.string().optional(),
    // Override the Anthropic API origin (local stubs, gateways).
    ANTHROPIC_BASE_URL: z.string().url().optional(),
    // Override the Claude model used for match summaries and icebreakers.
    // Only models that accept the request the app sends (src/aiModels.js).
    ANTHROPIC_MODEL: z.enum(AI_MODELS).optional(),
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
    // Local stand-in for the Stripe API (end-to-end runs only). Honoured only
    // for loopback addresses and refused outright in a production deployment,
    // see src/server/_billing/stripe.ts. Never set it on a deployed Worker.
    // The four price ids are required for checkout (docs/BILLING.md).
    STRIPE_API_BASE_URL: z.string().url().optional(),
    STRIPE_FOUNDING_ANNUAL_PRICE_ID: z.string().optional(),
    STRIPE_FOUNDING_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_STANDARD_ANNUAL_PRICE_ID: z.string().optional(),
    STRIPE_STANDARD_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string(),
    // Where Pro members' in-app support requests are sent (subject tagged
    // "[Pro]"). Optional: defaults to NEXT_PUBLIC_SUPPORT_EMAIL, then
    // support@myiso.app. Not shown to anyone.
    SUPPORT_INBOX_EMAIL: z.string().email().optional(),
  },

  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
