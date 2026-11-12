// HTTP security headers for every route. Plain JavaScript because
// next.config.js imports it before any TypeScript is compiled.

/**
 * Header that carries the policy.
 *
 * The policy ships in report-only mode: browsers evaluate it and report
 * violations, but block nothing. Reports go to CSP_REPORT_PATH, which
 * forwards them to PostHog as `csp_violation` events, so what would break
 * is visible before anything is enforced.
 *
 * Switch this to "Content-Security-Policy" once the policy has run in
 * production without violations that matter.
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

/** Same-origin endpoint browsers post violation reports to. */
export const CSP_REPORT_PATH = "/api/csp-report";

/** Name of the reporting group (Reporting-Endpoints / report-to). */
export const CSP_REPORT_GROUP = "csp";

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
 * - Analytics and error tracking need no entry: the browser talks to
 *   PostHog only through this origin (see src/telemetryConfig.js). Session
 *   replay runs in a blob: worker.
 * - res.cloudinary.com / lh3.googleusercontent.com: uploaded images and
 *   Google profile pictures (the same hosts next/image may load).
 * - wss: same host: the realtime messaging WebSocket (/api/messages/ws).
 * - form-action Google/Stripe: sign-in and checkout leave the site through
 *   redirects that some browsers treat as form navigations.
 *
 * @param {{ baseUrl?: string; isDevelopment?: boolean }} [options]
 * @returns {string}
 */
export function buildContentSecurityPolicy(options = {}) {
  const { baseUrl, isDevelopment = false } = options;

  const appOrigin = originOf(baseUrl);
  const websocket = appOrigin ? [appOrigin.replace(/^http/, "ws")] : [];

  /** @type {Record<string, string[]>} */
  const directives = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "connect-src": [
      "'self'",
      ...websocket,
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
      // React refresh evaluates code in development only.
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "worker-src": ["'self'", "blob:"],
    // report-uri is what every browser understands today; report-to is its
    // successor and needs the Reporting-Endpoints header below.
    "report-uri": [CSP_REPORT_PATH],
    "report-to": [CSP_REPORT_GROUP],
  };

  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Headers applied to every response.
 *
 * @param {{ baseUrl?: string; isDevelopment?: boolean }} [options]
 * @returns {Array<{ key: string; value: string }>}
 */
export function buildSecurityHeaders(options = {}) {
  return [
    { key: CSP_HEADER, value: buildContentSecurityPolicy(options) },
    { key: "Reporting-Endpoints", value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` },
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
