// HTTP security headers. Plain JavaScript because next.config.js imports it
// before any TypeScript is compiled.
//
// Two parts:
// - buildSecurityHeaders: the static headers next.config.js sets on every
//   route (HSTS, nosniff, framing, referrer, permissions, COOP).
// - buildContentSecurityPolicy / contentSecurityPolicyHeader: the policy.
//   It carries a per-request nonce, so it is set at request time by the
//   middleware (src/_lib/contentSecurityPolicy.ts), not by next.config.js.
//   docs/adr/0002-csp.md says why.

/** Same-origin endpoint browsers post violation reports to. */
export const CSP_REPORT_PATH = "/api/csp-report";

/** Name of the reporting group (Reporting-Endpoints / report-to). */
export const CSP_REPORT_GROUP = "csp";

/**
 * How the policy is applied (CSP_MODE). "enforce" blocks what the policy
 * does not allow; "report-only" is the kill switch: browsers block nothing
 * and only report. Both send reports to CSP_REPORT_PATH.
 *
 * @typedef {"enforce" | "report-only"} CspMode
 */

/** @type {readonly ["enforce", "report-only"]} */
export const CSP_MODES = ["enforce", "report-only"];

/** @type {CspMode} */
export const DEFAULT_CSP_MODE = "enforce";

/**
 * Response header that carries the policy in a mode.
 *
 * @param {CspMode} mode
 * @returns {"Content-Security-Policy" | "Content-Security-Policy-Report-Only"}
 */
export function cspHeaderName(mode) {
  return mode === "report-only"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
}

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

/** A nonce is base64 (standard or URL-safe) of at least 128 bits. */
const NONCE_PATTERN = /^[A-Za-z0-9+/_-]{22,}={0,2}$/;

/**
 * Builds the Content-Security-Policy for this app.
 *
 * What each allowance is for:
 * - script-src 'nonce-…' 'strict-dynamic': only scripts carrying this
 *   response's nonce run (Next.js adds it to its bootstrap and RSC payload
 *   scripts; the root layout adds it to its own two inline scripts), plus
 *   what those scripts load (Next.js chunks, PostHog's lazily loaded
 *   extensions). No 'unsafe-inline', and no 'unsafe-eval' outside
 *   development (Zod runs jitless, src/instrumentation-client.ts). 'self'
 *   is for browsers that predate 'strict-dynamic'; newer ones ignore it.
 * - style-src 'unsafe-inline': Mantine writes style attributes and injects
 *   <style> elements at runtime. Style attributes cannot carry a nonce, and
 *   a nonce in style-src would switch 'unsafe-inline' off. Styles cannot
 *   run code.
 * - Analytics and error tracking need no entry: the browser talks to
 *   PostHog only through this origin (see src/telemetryConfig.js). Session
 *   replay runs in a blob: worker.
 * - res.cloudinary.com / lh3.googleusercontent.com: uploaded images and
 *   Google profile pictures (the same hosts next/image may load).
 * - wss: same host: the realtime messaging WebSocket (/api/messages/ws).
 * - form-action Google/Stripe: sign-in and checkout leave the site through
 *   redirects that some browsers treat as form navigations.
 *
 * @param {{ baseUrl?: string; isDevelopment?: boolean; nonce: string }} options
 * @returns {string}
 */
export function buildContentSecurityPolicy(options) {
  const { baseUrl, isDevelopment = false, nonce } = options;
  // The nonce ends up inside a header: refuse anything that is not a nonce.
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) {
    throw new TypeError("A CSP nonce must be base64 of at least 128 bits");
  }

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
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
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
 * The policy as a response header, in the given mode.
 *
 * @param {{ baseUrl?: string; isDevelopment?: boolean; mode: CspMode; nonce: string }} options
 * @returns {{ key: string; value: string }}
 */
export function contentSecurityPolicyHeader(options) {
  return { key: cspHeaderName(options.mode), value: buildContentSecurityPolicy(options) };
}

/**
 * Headers next.config.js applies to every response. The policy itself is
 * set per request (see the top of this file); the reporting endpoint it
 * names is declared here, for every route.
 *
 * @returns {Array<{ key: string; value: string }>}
 */
/**
 * Paths that skip the middleware (and so get no per-request page policy):
 * API routes, Next.js internals and images. Next.js can still render its
 * HTML not-found page for an unknown path under them, so they get a static
 * policy that allows nothing; it also hardens JSON responses.
 */
export const NON_PAGE_PATH_PREFIXES = ["/api", "/_next", "/img"];

/** The static policy for NON_PAGE_PATH_PREFIXES. */
export const NON_PAGE_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/**
 * next.config.js `headers()` entries that give every non-page path the
 * static policy.
 */
export function nonPageHeaderRules() {
  return NON_PAGE_PATH_PREFIXES.map((prefix) => ({
    source: `${prefix}/:path*`,
    headers: [{ key: "Content-Security-Policy", value: NON_PAGE_CONTENT_SECURITY_POLICY }],
  }));
}

export function buildSecurityHeaders() {
  return [
    { key: "Reporting-Endpoints", value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` },
    // Two years, sub-domains included. Browsers ignore it over plain http.
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Legacy equivalent of the policy's frame-ancestors 'none'; also covers
    // the responses the policy is not set on (API routes).
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
