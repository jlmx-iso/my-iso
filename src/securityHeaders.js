// HTTP security headers for every route. Plain JavaScript because
// next.config.js imports it before any TypeScript is compiled.

/**
 * Header that carries the policy.
 *
 * The policy ships in report-only mode: browsers evaluate it and log
 * violations to the console, but block nothing.
 *
 * Status of the last headless-Chromium run over every route (signed out and
 * signed in): no violation except one, on pages that validate forms with Zod
 * in the browser (/app/events, /app/messages). Zod 4 probes for `eval`
 * support with `new Function("")` inside a try/catch and falls back when it
 * is refused, so enforcing would not break those pages, but the probe is
 * reported. Calling `z.config({ jitless: true })` before any schema is used
 * on the client removes it.
 *
 * Switch this to "Content-Security-Policy" once that is done and the
 * report-only policy has run in production without violations (PostHog with
 * a real key, Sentry and the Stripe/Google redirects only run there).
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

/**
 * @param {string | undefined} value
 * @returns {string | null} the URL's origin, or null if it is not a URL
 */
function originOf(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Builds the Content-Security-Policy for this app.
 *
 * What each allowance is for:
 * - script/style 'unsafe-inline': Next.js emits inline bootstrap scripts
 *   (the RSC payload) and Mantine sets inline styles; without per-request
 *   nonces, which would force every page to render dynamically, they cannot
 *   be allow-listed more narrowly.
 * - PostHog: analytics script and API on the configured host and its asset
 *   host; session replay runs in a blob: worker.
 * - res.cloudinary.com / lh3.googleusercontent.com: uploaded images and
 *   Google profile pictures (the same hosts next/image may load).
 * - wss: same host: the realtime messaging WebSocket (/api/messages/ws).
 * - form-action Google/Stripe: sign-in and checkout leave the site through
 *   redirects that some browsers treat as form navigations.
 *
 * @param {{ baseUrl?: string; isDevelopment?: boolean; posthogHost?: string }} [options]
 * @returns {string}
 */
export function buildContentSecurityPolicy(options = {}) {
  const { baseUrl, isDevelopment = false, posthogHost } = options;

  const posthogOrigin = originOf(posthogHost);
  const posthog = [
    ...(posthogOrigin ? [posthogOrigin] : []),
    "https://*.posthog.com",
  ];

  const appOrigin = originOf(baseUrl);
  const websocket = appOrigin ? [appOrigin.replace(/^http/, "ws")] : [];

  /** @type {Record<string, string[]>} */
  const directives = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "connect-src": [
      "'self'",
      ...websocket,
      ...posthog,
      "https://*.ingest.sentry.io",
      "https://*.ingest.us.sentry.io",
      // Next.js dev server (hot reload).
      ...(isDevelopment ? ["ws:"] : []),
    ],
    "font-src": ["'self'", "data:"],
    "form-action": [
      "'self'",
      "https://accounts.google.com",
      "https://checkout.stripe.com",
      "https://billing.stripe.com",
    ],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://res.cloudinary.com",
      "https://lh3.googleusercontent.com",
    ],
    "manifest-src": ["'self'"],
    "media-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...posthog,
      // React refresh evaluates code in development only.
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "worker-src": ["'self'", "blob:"],
  };

  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Headers applied to every response.
 *
 * @param {{ baseUrl?: string; isDevelopment?: boolean; posthogHost?: string }} [options]
 * @returns {Array<{ key: string; value: string }>}
 */
export function buildSecurityHeaders(options = {}) {
  return [
    { key: CSP_HEADER, value: buildContentSecurityPolicy(options) },
    // Two years, sub-domains included. Browsers ignore it over plain http.
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Legacy equivalent of frame-ancestors 'none', which is enforced by the
    // CSP only once that leaves report-only mode.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
}
