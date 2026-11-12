// Analytics consent: one cookie, three states, readable on the server and in
// the browser. This module only holds the state logic; the banner that lets
// people choose is a later change and will call `serializeConsentCookie`.
//
// No imports on purpose: the browser entry, server code and the Worker all
// use it.

export type ConsentState = "unknown" | "granted" | "denied";

/** First-party cookie that stores an explicit choice. Absent = no choice yet. */
export const CONSENT_COOKIE = "iso_consent";

/** How long an explicit choice is remembered (six months). */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;

/** What a consent state permits. */
export type ConsentCapabilities = {
  /** Product analytics events and error reports. */
  capture: boolean;
  /** Email and name attached to the person in PostHog. */
  personProperties: boolean;
  /** Session replay. */
  sessionReplay: boolean;
};

/**
 * The value of the consent cookie in a `Cookie` header (or
 * `document.cookie`), or null if it is absent or not a recognised value.
 */
export function parseConsentCookie(
  cookieHeader: string | null | undefined,
): "granted" | "denied" | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== CONSENT_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    if (value === "granted" || value === "denied") return value;
  }
  return null;
}

/**
 * Resolves the consent state from its two inputs.
 *
 * A Global Privacy Control signal (`Sec-GPC: 1` on the server,
 * `navigator.globalPrivacyControl` in the browser) is a refusal and wins
 * over everything, including an earlier "granted" cookie: the signal is the
 * visitor's current, browser-wide instruction.
 */
export function resolveConsent(input: {
  cookie: "granted" | "denied" | null;
  globalPrivacyControl: boolean;
}): ConsentState {
  if (input.globalPrivacyControl) return "denied";
  return input.cookie ?? "unknown";
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
 * - unknown (no banner has asked yet): anonymous product analytics and
 *   error reports only. Session replay and person properties need an
 *   explicit yes.
 * - granted: everything.
 */
export function consentCapabilities(state: ConsentState): ConsentCapabilities {
  return {
    capture: state !== "denied",
    personProperties: state === "granted",
    sessionReplay: state === "granted",
  };
}

/** Consent for a server request, from its headers. */
export function consentFromHeaders(headers: Headers): ConsentState {
  return resolveConsent({
    cookie: parseConsentCookie(headers.get("cookie")),
    globalPrivacyControl: headers.get("sec-gpc")?.trim() === "1",
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
