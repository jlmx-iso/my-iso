import { handlers } from "~/auth";

/**
 * Auth.js v5 API route handler
 * Handles all NextAuth routes (/api/auth/*)
 */
export const { GET, POST } = handlers;

/**
 * Runtime configuration: Edge runtime for Cloudflare Workers/Pages
 *
 * When running with wrangler pages dev, this uses D1 database
 * When running with npm run dev (Node.js), change to 'nodejs'
 */
// Use 'nodejs' for local dev, 'edge' for Cloudflare deployment
export const runtime = 'nodejs';
