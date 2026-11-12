import type { D1Database, DurableObjectNamespace, Fetcher, RateLimit } from "@cloudflare/workers-types";

import type { ChatRoom } from "./src/do/ChatRoom";

export interface CloudflareEnv {
  ASSETS: Fetcher;
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  DB: D1Database;
  /** Admits counted page views (wrangler.toml `ratelimits`); absent off Cloudflare. */
  VIEW_COUNT_LIMIT?: RateLimit;

  // Variables and secrets the Worker entry itself reads (worker.ts). The
  // Next.js app reads its configuration through src/env.js instead.
  /** `production` or `staging`; set per environment in wrangler.toml. */
  APP_ENV?: string;
  /** Secret. Also signs the internal scheduled-job requests. */
  AUTH_SECRET?: string;
  /** PostHog project token (public). Enables Worker-level error reports. */
  NEXT_PUBLIC_POSTHOG_PUBLIC_KEY?: string;
  /** PostHog origins; default to US Cloud (src/telemetryConfig.js). */
  POSTHOG_ASSETS_HOST?: string;
  POSTHOG_HOST?: string;
}
