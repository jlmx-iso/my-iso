// Analytics consent: one cookie, readable on the server and in the browser,
// plus the visitor's region. This module only holds the state logic; the
// banner that lets people choose (~/app/_components/consent) writes the
// cookie through `setAnalyticsConsent` (~/_lib/analyticsBrowser).
//
// No imports on purpose: the browser entry, server code and the Worker all
// use it.

/**
 * - unknown: no choice yet, outside the opt-in regions (see
 *   `consentRequiresOptIn`; inside them no choice resolves to "denied").
 * - granted: analytics, person properties, browser storage and session
 *   replay.
 * - analytics: the same without session replay.
 * - denied: nothing.
 */
export type ConsentState = "unknown" | "granted" | "analytics" | "denied";

/** A choice made explicitly, as the cookie stores it. */
export type ConsentChoice = Exclude<ConsentState, "unknown">;

/** First-party cookie that stores an explicit choice. Absent = no choice yet. */
export const CONSENT_COOKIE = "iso_consent";

/** How long an explicit choice is remembered (six months). */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;

/** What a consent state permits. */
export type ConsentCapabilities = {
  /** Product analytics events and error reports. */
  capture: boolean;
  /**
   * Non-identifying attributes (plan, role) attached to the person in
   * PostHog. Never a name or email address, in any state.
   */
  personProperties: boolean;
  /** Session replay. */
  sessionReplay: boolean;
  /**
   * Analytics state kept in the browser across page loads (PostHog's
   * cookie and localStorage). Without it the SDK keeps its state in memory
   * only, so an anonymous visitor gets a new id on every page load.
   */
  storage: boolean;
};

/**
 * The value of the consent cookie in a `Cookie` header (or
 * `document.cookie`), or null if it is absent or not a recognised value.
 */
export function parseConsentCookie(cookieHeader: string | null | undefined): ConsentChoice | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== CONSENT_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    if (value === "granted" || value === "analytics" || value === "denied") return value;
  }
  return null;
}

/**
 * Request header carrying the visitor's country (ISO 3166-1 alpha-2, from
 * Cloudflare's `request.cf.country`). The Worker entry sets it on every
 * request and drops any value the client sent (src/worker/country.ts). It
 * is absent where no Worker is in front (`next dev`).
 */
export const COUNTRY_HEADER = "x-iso-country";

/**
 * Where analytics wait for an explicit yes: the EU (outermost regions
 * included), the rest of the EEA, the United Kingdom with the Crown
 * Dependencies and Gibraltar, Switzerland, Canada and Brazil. Elsewhere a visitor who has not
 * chosen is counted pseudonymously (see `consentCapabilities`).
 */
export const OPT_IN_COUNTRIES: ReadonlySet<string> = new Set([
  // EU member states
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
  // The rest of the EEA
  "IS", "LI", "NO",
  // EU outermost regions with their own country codes
  "GF", "GP", "MQ", "RE", "YT", "MF", "AX",
  // United Kingdom, Crown Dependencies and Gibraltar
  "GB", "GI", "JE", "GG", "IM",
  // Switzerland
  "CH",
  // Canada (Quebec's Law 25 wants analytics off by default, and Cloudflare
  // does not give the province) and Brazil (LGPD)
  "CA", "BR",
]);

/**
 * What Cloudflare reports when it cannot place a visitor: "XX" (unknown)
 * and "T1" (Tor). The visitor could be anywhere, so the stricter rule
 * applies.
 */
const UNPLACED_COUNTRIES: ReadonlySet<string> = new Set(["XX", "T1"]);

/**
 * Whether a visitor from `country` must opt in before any analytics run.
 * The one place the region rule lives (docs/DEPLOYMENT.md, "Consent by
 * region").
 *
 * No country at all (null or empty) happens only without the Worker in
 * front, in local development; the default rule applies there.
 */
export function consentRequiresOptIn(country: string | null | undefined): boolean {
  const code = country?.trim().toUpperCase();
  if (!code) return false;
  return OPT_IN_COUNTRIES.has(code) || UNPLACED_COUNTRIES.has(code);
}

/**
 * Resolves the consent state from its inputs.
 *
 * A Global Privacy Control signal (`Sec-GPC: 1` on the server,
 * `navigator.globalPrivacyControl` in the browser) is a refusal and wins
 * over everything, including an earlier "granted" cookie: the signal is the
 * visitor's current, browser-wide instruction.
 *
 * In an opt-in region (`optInRequired`) no choice is a refusal: the result
 * is "denied", never "unknown", until the visitor accepts.
 */
export function resolveConsent(input: {
  cookie: ConsentChoice | null;
  globalPrivacyControl: boolean;
  optInRequired?: boolean;
}): ConsentState {
  if (input.globalPrivacyControl) return "denied";
  if (input.cookie) return input.cookie;
  return input.optInRequired ? "denied" : "unknown";
}

/**
 * What each state allows.
 *
 * - denied: nothing is captured about the visitor. In the browser PostHog
 *   is not initialised at all, the telemetry proxy answers 204 without
 *   contacting PostHog, and no server-side product event is sent.
 *   One thing is still sent, and it is not about the visitor: an exception
 *   on the server is reported for operational monitoring, anonymously (no
 *   user id, nothing derived from the visitor, no IP address, no query
 *   string). See `captureServerException` in ~/server/_lib/posthog.
 * - unknown (no choice yet, outside the opt-in regions): product analytics
 *   and error reports, with nothing stored in the browser. A signed-in
 *   member's events carry their user id (pseudonymous: never email or
 *   name); a visitor who is not signed in is anonymous. Session replay,
 *   person properties and browser storage need an explicit yes.
 * - analytics: an explicit yes to analytics, without session replay.
 * - granted: everything.
 */
export function consentCapabilities(state: ConsentState): ConsentCapabilities {
  const explicit = state === "granted" || state === "analytics";
  return {
    capture: state !== "denied",
    personProperties: state === "granted",
    sessionReplay: state === "granted",
    storage: explicit,
  };
}

/**
 * Consent for a server request, from its headers: the cookie, `Sec-GPC`,
 * and the country the Worker entry put in COUNTRY_HEADER.
 */
export function consentFromHeaders(headers: Headers): ConsentState {
  return resolveConsent({
    cookie: parseConsentCookie(headers.get("cookie")),
    globalPrivacyControl: headers.get("sec-gpc")?.trim() === "1",
    optInRequired: consentRequiresOptIn(headers.get(COUNTRY_HEADER)),
  });
}

/**
 * `Set-Cookie` / `document.cookie` value recording an explicit choice, or
 * clearing it for "unknown". Not HttpOnly: the browser SDK has to read it.
 */
export function serializeConsentCookie(
  state: ConsentState,
  options: { secure?: boolean } = {},
): string {
  const attributes = ["Path=/", "SameSite=Lax", ...(options.secure ? ["Secure"] : [])];
  if (state === "unknown") {
    return [`${CONSENT_COOKIE}=`, "Max-Age=0", ...attributes].join("; ");
  }
  return [`${CONSENT_COOKIE}=${state}`, `Max-Age=${CONSENT_MAX_AGE_SECONDS}`, ...attributes].join(
    "; ",
  );
}
