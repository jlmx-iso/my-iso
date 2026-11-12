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
import { logger } from "~/_utils";

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
 * `context.distinctId` is the signed-in user's id when one is known. It is
 * dropped when that visitor has refused analytics, so the error is still
 * counted but not tied to a person. Only what `context` lists is sent:
 * never request bodies, cookies or authorization headers.
 */
export function captureServerException(error: unknown, context: ExceptionContext): void {
  const settings = getPostHogSettings();
  if (!settings) return;

  const consent = currentRequestConsent();
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
 * Resolves to `undefined` when the flag does not exist, is switched off, or
 * PostHog could not be reached: the SDK reports all three as "no value".
 * Callers must therefore treat `undefined` as their safe default. Throws
 * when analytics are not configured at all.
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

/** `getFeatureFlag` that answers `fallback` instead of throwing. */
async function isFlagEnabled(key: string, distinctId: string, fallback: boolean): Promise<boolean> {
  try {
    const value = await getFeatureFlag(key, distinctId);
    return value === undefined ? false : value !== false;
  } catch (error) {
    logger.warn("Feature flag evaluation failed", { error, flag: key });
    return fallback;
  }
}

export function isFoundingMember(userId: string): Promise<boolean> {
  return isFlagEnabled("founding_member", userId, false);
}

export function hasProAccess(userId: string): Promise<boolean> {
  return isFlagEnabled("pro_access", userId, false);
}

/** Open by default: founding pricing stays on if PostHog is unavailable. */
export function isFoundingMemberPricingActive(): Promise<boolean> {
  return isFlagEnabled("founding_member_pricing_active", "anonymous", true);
}
