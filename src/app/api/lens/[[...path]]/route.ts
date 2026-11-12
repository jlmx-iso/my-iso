import { handleTelemetryProxy } from "~/_lib/telemetryProxy";
import { env } from "~/env";
import {
  resolvePostHogHosts,
  TELEMETRY_FALLBACK_ROUTE,
  TELEMETRY_PROXY_PATH,
} from "~/telemetryConfig";

export const dynamic = "force-dynamic";

/**
 * The first-party telemetry proxy for when no Worker is in front of Next.js
 * (`next dev`, `next start`). On Cloudflare, worker.ts answers
 * TELEMETRY_PROXY_PATH itself and this route is never reached; a rewrite in
 * next.config.js maps that path here otherwise.
 *
 * Same handler, same rules: cookies and credentials are stripped, methods
 * and body size are limited.
 */
function proxy(request: Request): Promise<Response> {
  // Depending on how the request arrived, the URL carries the public path
  // or this route's own path. Normalise to the public one.
  const url = new URL(request.url);
  if (url.pathname.startsWith(TELEMETRY_FALLBACK_ROUTE)) {
    url.pathname = TELEMETRY_PROXY_PATH + url.pathname.slice(TELEMETRY_FALLBACK_ROUTE.length);
  }

  return handleTelemetryProxy(new Request(url, request), {
    ...resolvePostHogHosts({
      POSTHOG_ASSETS_HOST: env.POSTHOG_ASSETS_HOST,
      POSTHOG_HOST: env.POSTHOG_HOST,
    }),
    // Only an edge in front of the app knows the visitor's address.
    clientIp: request.headers.get("cf-connecting-ip"),
  });
}

export { proxy as GET, proxy as HEAD, proxy as POST };
