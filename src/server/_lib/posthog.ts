// PostHog on the server: product events, error tracking and feature flags.
//
// Nothing here blocks a response. Events and exceptions are sent after the
// response through `runAfterResponse` (Cloudflare `waitUntil`), and each
// send is flushed before its promise settles, so the Worker cannot drop it.
// See ~/_lib/posthogServer for why there is no long-lived client.

import { consentCapabilities, consentFromHeaders, type ConsentState } from "~/_lib/consent";
import {
  type ExceptionContext,
  sendEvent,
  sendException,
  withPostHog,
} from "~/_lib/posthogServer";

import { runAfterResponse } from "./background";
import { getPostHogSettings } from "./posthogSettings";

export type { ExceptionContext } from "~/_lib/posthogServer";
export { getPostHogSettings } from "./posthogSettings";

/**
 * Consent of the request being handled, from its cookie and `Sec-GPC`
 * header. "unknown" outside a request (scheduled jobs, webhooks' background
 * work) or wherever Next.js cannot provide the headers.
 */
async function currentRequestConsent(): Promise<ConsentState> {
  try {
    const { headers } = await import("next/headers");
    return consentFromHeaders(await headers());
  } catch {
    return "unknown";
  }
}

/**
 * Records a product event for `distinctId` (a user id or a keyed hash,
 * never an email address). Returns immediately; the event is sent after the
 * response. Nothing is sent when the visitor has refused analytics.
 */
export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  const settings = getPostHogSettings();
  if (!settings) return;

  // Read while the request is still in scope; the send itself happens later.
  const consent = currentRequestConsent();
  runAfterResponse(`posthog:${event}`, async () => {
    if (!consentCapabilities(await consent).capture) return;
    await sendEvent(settings, { distinctId, event, properties });
  });
}

/**
 * Reports a server-side exception to PostHog error tracking. Returns
 * immediately; the report is sent after the response.
 *
 * The rule for consent (also stated in ~/_lib/consent): server errors are
 * operational data and are always reported, but for a visitor who has
 * refused analytics the report is anonymous. It then carries no user id and
 * nothing derived from the visitor: a random id per event, no person
 * profile, no IP address, and a path without its query string. With consent
 * unknown or granted, `context.distinctId` (the user id) is attached.
 *
 * Consent is read from the request being handled. Callers that hold the
 * request's headers themselves, because Next.js cannot provide them where
 * they run (`onRequestError`), pass `options.consent`.
 *
 * Only what `context` lists is sent: never request bodies, cookies or
 * authorization headers. Query strings, email addresses and codes are
 * scrubbed from the error text and stack (~/_lib/telemetryScrub).
 */
export function captureServerException(
  error: unknown,
  context: ExceptionContext,
  options: { consent?: ConsentState } = {},
): void {
  const settings = getPostHogSettings();
  if (!settings) return;

  const consent = options.consent ?? currentRequestConsent();
  runAfterResponse(`posthog:exception:${context.source}`, async () => {
    const identified = consentCapabilities(await consent).capture;
    await sendException(settings, error, {
      ...context,
      distinctId: identified ? context.distinctId : undefined,
    });
  });
}

export type FeatureFlagValue = boolean | string | undefined;

/**
 * Evaluates one feature flag for `distinctId` through PostHog's `/flags`
 * API (posthog-node `evaluateFlags`).
 *
 * - `true` or a variant name: the flag is on for this id.
 * - `false`: the flag is active and evaluates to off for this id.
 * - `undefined`: no value. The flag does not exist or is disabled in
 *   PostHog, or PostHog could not be reached (the SDK does not tell these
 *   apart). Callers must treat it as their safe default.
 *
 * Throws when analytics are not configured at all.
 * (src/server/_lib/featureFlags.test.ts pins this against the real SDK.)
 *
 * Flag payloads are neither requested nor logged, and no
 * `$feature_flag_called` event is sent.
 */
export async function getFeatureFlag(key: string, distinctId: string): Promise<FeatureFlagValue> {
  if (!distinctId) throw new Error("A distinct id is required to evaluate a feature flag");
  const settings = getPostHogSettings();
  if (!settings) throw new Error("PostHog is not configured");

  return withPostHog(settings, async (client) => {
    const flags = await client.evaluateFlags(distinctId, { flagKeys: [key] });
    return flags.getFlag(key, { sendFeatureFlagEvents: false });
  });
}
