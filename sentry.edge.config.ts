// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// Compatible with both Vercel Edge Runtime and Cloudflare Workers
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? "https://1eb20c8eba215e47c37eee6a32c80349@o4507352188977152.ingest.us.sentry.io/4507352192909312",

  // Lower sample rate in production to reduce costs
  // Use 0.1 (10%) for production, 1.0 (100%) for development
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Enable debug mode in development
  debug: process.env.NODE_ENV === 'development',

  // Tag with environment
  environment: process.env.NODE_ENV ?? 'development',

  // Enable edge runtime features
  // Note: Some features may not be available on Cloudflare Workers
  integrations: [],
});
