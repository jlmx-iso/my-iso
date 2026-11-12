// PostHog in the browser: the one place it is configured, started and
// stopped. src/instrumentation-client.ts starts it on page load;
// ~/app/providers ties it to the signed-in user; a consent banner (later
// change) calls `setAnalyticsConsent`.
//
// Everything is sent to the app's own origin (TELEMETRY_PROXY_PATH) and
// forwarded to PostHog from there, so the browser makes no third-party
// requests. With consent refused the SDK is never initialised: no events,
// no config or script fetches, nothing.

import type { CaptureResult, PostHogConfig } from "posthog-js";
import posthog from "posthog-js";

import { DEFAULT_POSTHOG_UI_HOST, TELEMETRY_PROXY_PATH } from "../telemetryConfig.js";
import {
  consentCapabilities,
  type ConsentState,
  parseConsentCookie,
  resolveConsent,
  serializeConsentCookie,
} from "./consent";
import { scrubPersonProperties, scrubProperties, stripUrlQuery } from "./telemetryScrub";

/** Consent in the browser. "unknown" when there is no document (SSR). */
export function readBrowserConsent(): ConsentState {
  if (typeof document === "undefined") return "unknown";
  const gpc =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  return resolveConsent({
    cookie: parseConsentCookie(document.cookie),
    globalPrivacyControl: gpc,
  });
}

/**
 * Session replay: what is hidden in a recording.
 *
 * Whether replay records at all is a PostHog project setting plus explicit
 * consent here. When it does, a recording must not contain what people
 * wrote or who they are:
 *
 * - `maskAllInputs`: nothing typed into any field is recorded.
 * - `maskTextSelector: "*"`: ALL text on every page is replaced with
 *   asterisks. Messages, names, email addresses and phone numbers are text
 *   like any other, and the markup has no reliable way yet to tell them
 *   apart, so everything is masked. A recording still shows layout, clicks,
 *   navigation and errors.
 * - `blockSelector`: elements carrying `data-replay-block` are replaced by
 *   an empty box of the same size. Meant for images that identify people
 *   (avatars, portfolio photos, attachments): masking text does not hide
 *   pictures.
 *
 * To make recordings readable later, replace "*" with
 * `REPLAY_PRIVATE_TEXT_SELECTOR` once every element listed in
 * docs/DEPLOYMENT.md ("Session replay") carries `data-private`.
 */
export const REPLAY_MASK_ALL_TEXT = "*";
export const REPLAY_PRIVATE_TEXT_SELECTOR = "[data-private]";
export const REPLAY_BLOCK_SELECTOR = "[data-replay-block]";

/**
 * Removes query strings, email addresses, invite codes (and, in error text,
 * sign-in codes) from an event before it is sent. See ./telemetryScrub.
 */
export function beforeSend(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;
  return {
    ...event,
    properties: scrubProperties(event.properties),
    ...(event.$set ? { $set: scrubPersonProperties(event.$set) } : {}),
    ...(event.$set_once ? { $set_once: scrubPersonProperties(event.$set_once) } : {}),
  };
}

/** The configuration PostHog is started with. Exported for tests. */
export function buildPostHogConfig(options: {
  environment: string;
  sessionReplay: boolean;
  uiHost?: string;
}): Partial<PostHogConfig> {
  return {
    api_host: TELEMETRY_PROXY_PATH,
    ui_host: options.uiHost ?? DEFAULT_POSTHOG_UI_HOST,
    defaults: "2026-08-30",

    // App Router: a $pageview on load and on every client-side navigation.
    capture_pageview: "history_change",
    // Uncaught errors and unhandled rejections go to error tracking.
    capture_exceptions: true,
    // Anonymous visitors do not create person profiles.
    person_profiles: "identified_only",

    // The browser evaluates no feature flags (the server does), so it never
    // calls /flags; surveys are not used either. Neither is reachable
    // through the proxy.
    advanced_disable_flags: true,
    disable_surveys: true,

    before_send: beforeSend,

    disable_session_recording: !options.sessionReplay,
    session_recording: {
      blockSelector: REPLAY_BLOCK_SELECTOR,
      maskAllInputs: true,
      // Also applied by the recorder to the page URL of every snapshot.
      maskCapturedNetworkRequestFn: (request) => ({
        ...request,
        name: stripUrlQuery(request.name),
      }),
      maskTextSelector: REPLAY_MASK_ALL_TEXT,
    },

    loaded: (instance) => {
      instance.register({ environment: options.environment });
    },
  };
}

/**
 * Starts PostHog if it is configured and the visitor has not refused
 * analytics. Safe to call more than once. Returns whether it is running.
 */
export function startAnalytics(): boolean {
  if (posthog.__loaded) return true;

  // Read directly (not through ~/env) so the browser entry stays free of
  // the env schema and Zod; the values are inlined at build time.
  const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY;
  if (!projectToken) return false;

  const capabilities = consentCapabilities(readBrowserConsent());
  if (!capabilities.capture) return false;

  posthog.init(
    projectToken,
    buildPostHogConfig({
      environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
      sessionReplay: capabilities.sessionReplay,
      uiHost: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
    }),
  );
  return true;
}

/**
 * Records the visitor's choice and applies it at once.
 *
 * - "denied": capture stops now. The SDK is opted out, replay stops, and
 *   the stored identity is dropped. From the next page load the SDK is not
 *   initialised at all.
 * - "granted": analytics start (if they were not running) and replay may
 *   record.
 * - "unknown": the choice is forgotten; anonymous analytics only.
 *
 * A Global Privacy Control signal still overrides a "granted" choice.
 */
export function setAnalyticsConsent(state: ConsentState): void {
  if (typeof document === "undefined") return;
  document.cookie = serializeConsentCookie(state, {
    secure: typeof location !== "undefined" && location.protocol === "https:",
  });

  const capabilities = consentCapabilities(readBrowserConsent());
  if (!capabilities.capture) {
    if (posthog.__loaded) {
      posthog.stopSessionRecording();
      posthog.reset();
      posthog.opt_out_capturing();
    }
    forgetIdentifiedUser();
    return;
  }

  if (!startAnalytics()) return;
  if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
  if (capabilities.sessionReplay) posthog.startSessionRecording();
  else posthog.stopSessionRecording();
}

/** Where this browser remembers which user it identified to PostHog. */
const IDENTIFIED_USER_KEY = "iso_analytics_user";

function readIdentifiedUser(): string | null {
  try {
    return window.localStorage.getItem(IDENTIFIED_USER_KEY);
  } catch {
    return null;
  }
}

function forgetIdentifiedUser(): void {
  try {
    window.localStorage.removeItem(IDENTIFIED_USER_KEY);
  } catch {
    // Storage is unavailable; nothing was remembered.
  }
}

export type AnalyticsUser = {
  email?: string | null;
  id: string;
  name?: string | null;
};

/**
 * Ties PostHog's visitor to the signed-in user, or cuts the tie when nobody
 * is signed in any more.
 *
 * The distinct id is the user id, never the email address. Email and name
 * are attached as person properties only with explicit consent. On sign-out
 * the identity is reset, so the next person on this browser does not
 * inherit it. Does nothing while PostHog is not running.
 */
export function syncAnalyticsUser(user: AnalyticsUser | null): void {
  if (!posthog.__loaded) return;
  const capabilities = consentCapabilities(readBrowserConsent());
  if (!capabilities.capture) return;

  const identified = readIdentifiedUser();

  if (user === null) {
    if (identified !== null) {
      posthog.reset();
      forgetIdentifiedUser();
    }
    return;
  }

  // Someone else was signed in on this browser: start from a clean identity.
  if (identified !== null && identified !== user.id) posthog.reset();

  if (capabilities.personProperties) {
    posthog.identify(user.id, {
      ...(user.email ? { email: user.email } : {}),
      ...(user.name ? { name: user.name } : {}),
    });
  } else {
    // A repeat call with the same id sends nothing.
    posthog.identify(user.id);
  }

  try {
    window.localStorage.setItem(IDENTIFIED_USER_KEY, user.id);
  } catch {
    // Without storage the reset on sign-out is skipped; the next identify
    // with a different id still resets through PostHog's own check.
  }
}

/** Reports an error caught by a React error boundary. No-op when stopped. */
export function captureBoundaryError(error: unknown, boundary: string): void {
  if (!posthog.__loaded) return;
  posthog.captureException(error, { boundary });
}
