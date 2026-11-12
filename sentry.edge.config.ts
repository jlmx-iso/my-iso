// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// Compatible with both Vercel Edge Runtime and Cloudflare Workers
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

// Sentry only starts when a DSN is configured, so local runs, CI and preview
// builds never report into the production project by accident.
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,

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
}
