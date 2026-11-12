// Where analytics and error tracking go. Plain JavaScript because
// next.config.js imports it before any TypeScript is compiled; worker.ts and
// the browser entry import it too.

/**
 * Same-origin path the browser sends all PostHog traffic to. The Worker
 * entry (worker.ts) forwards it to PostHog; under `next dev` / `next start`
 * a Next.js rewrite hands it to a route that does the same (next.config.js).
 *
 * The name is deliberately unrelated to what it carries: content blockers
 * match on words such as "analytics", "tracking" or the vendor's name.
 */
export const TELEMETRY_PROXY_PATH = "/lens";

/** Next.js route the rewrite lands on when there is no Worker in front. */
export const TELEMETRY_FALLBACK_ROUTE = "/api/lens";

/** PostHog US Cloud. Set POSTHOG_HOST / POSTHOG_ASSETS_HOST for EU. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
export const DEFAULT_POSTHOG_ASSETS_HOST = "https://us-assets.i.posthog.com";
/** The PostHog app itself (toolbar, links from the SDK); never proxied. */
export const DEFAULT_POSTHOG_UI_HOST = "https://us.posthog.com";

/**
 * @param {string | undefined} value
 * @param {string} fallback
 * @returns {string} an origin (scheme + host + port), never with a path
 */
function originOr(value, fallback) {
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
  } catch {
    // fall through
  }
  return fallback;
}

/**
 * The PostHog hosts for this deployment, from configuration with US Cloud
 * defaults. Invalid values fall back to the defaults.
 *
 * @param {{ POSTHOG_HOST?: string; POSTHOG_ASSETS_HOST?: string }} [vars]
 * @returns {{ apiHost: string; assetsHost: string }}
 */
export function resolvePostHogHosts(vars = {}) {
  return {
    apiHost: originOr(vars.POSTHOG_HOST, DEFAULT_POSTHOG_HOST),
    assetsHost: originOr(vars.POSTHOG_ASSETS_HOST, DEFAULT_POSTHOG_ASSETS_HOST),
  };
}
