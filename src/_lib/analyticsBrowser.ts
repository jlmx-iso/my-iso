// PostHog in the browser: the one place it is configured, started and
// stopped. src/instrumentation-client.ts starts it on page load;
// ~/app/providers ties it to the signed-in user; the consent banner
// (~/app/_components/consent) calls `setAnalyticsConsent`.
//
// Everything is sent to the app's own origin (TELEMETRY_PROXY_PATH) and
// forwarded to PostHog from there, so the browser makes no third-party
// requests. With consent refused the SDK is never initialised: no events,
// no config or script fetches, nothing.

import type { CaptureResult, PostHogConfig } from "posthog-js";
import posthog from "posthog-js";

import {
  consentCapabilities,
  type ConsentChoice,
  type ConsentState,
  parseConsentCookie,
  resolveConsent,
  serializeConsentCookie,
} from "~/_lib/consent";
import { scrubPersonProperties, scrubProperties, stripUrlQuery } from "~/_lib/telemetryScrub";
import { DEFAULT_POSTHOG_UI_HOST, TELEMETRY_PROXY_PATH } from "~/telemetryConfig.js";

/**
 * Attribute on `<html>` saying the visitor is in an opt-in region (value
 * CONSENT_REGION_OPT_IN). The root layout sets it from the request's
 * country (~/_lib/consent, consentRequiresOptIn); it is in the server HTML,
 * so it is there before this module first runs.
 */
export const CONSENT_REGION_ATTRIBUTE = "data-consent-region";
export const CONSENT_REGION_OPT_IN = "opt-in";

/** Whether the browser sends a Global Privacy Control signal. */
export function hasGlobalPrivacyControl(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

/** Whether the page says the visitor is in an opt-in region. */
export function isOptInRegion(): boolean {
  return (
    typeof document !== "undefined" &&
    // Optional: a document without a root element (some tests) is not one.
    document.documentElement?.getAttribute(CONSENT_REGION_ATTRIBUTE) === CONSENT_REGION_OPT_IN
  );
}

/** The choice stored in the consent cookie, or null if none was made. */
export function readConsentChoice(): ConsentChoice | null {
  if (typeof document === "undefined") return null;
  return parseConsentCookie(document.cookie);
}

/** Consent in the browser. "unknown" when there is no document (SSR). */
export function readBrowserConsent(): ConsentState {
  if (typeof document === "undefined") return "unknown";
  return resolveConsent({
    cookie: readConsentChoice(),
    globalPrivacyControl: hasGlobalPrivacyControl(),
    optInRequired: isOptInRegion(),
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

/**
 * Where PostHog keeps its state (anonymous id, session, super properties).
 * Only explicit consent lets it use the browser's cookie and localStorage;
 * until then it lives in memory and is gone with the page.
 */
export function persistenceFor(storage: boolean): PostHogConfig["persistence"] {
  return storage ? "localStorage+cookie" : "memory";
}

/** The configuration PostHog is started with. Exported for tests. */
export function buildPostHogConfig(options: {
  environment: string;
  sessionReplay: boolean;
  storage: boolean;
  uiHost?: string;
}): Partial<PostHogConfig> {
  return {
    api_host: TELEMETRY_PROXY_PATH,
    ui_host: options.uiHost ?? DEFAULT_POSTHOG_UI_HOST,
    defaults: "2026-08-30",
    persistence: persistenceFor(options.storage),

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
      // Network entries keep timing and a URL without its query, never
      // headers or bodies (message text, tokens, cookies), whatever the
      // project's remote settings ask for. Replay data is compressed before
      // `before_send` sees it, so this is the only place to remove them.
      recordBody: false,
      recordHeaders: false,
      // Also applied by the recorder to the page URL of every snapshot.
      maskCapturedNetworkRequestFn: (request) => {
        const {
          requestBody: _requestBody,
          requestHeaders: _requestHeaders,
          responseBody: _responseBody,
          responseHeaders: _responseHeaders,
          ...rest
        } = request;
        return { ...rest, name: stripUrlQuery(request.name) };
      },
      maskTextSelector: REPLAY_MASK_ALL_TEXT,
    },

    loaded: (instance) => {
      // No location from an IP address: the proxy passes none on, and this
      // stops PostHog deriving one from the address it does see.
      instance.register({ $geoip_disable: true, environment: options.environment });
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
      storage: capabilities.storage,
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
 * - "granted": analytics start (if they were not running), replay may
 *   record, and PostHog moves its state from memory to the browser's
 *   storage.
 * - "unknown": the choice is forgotten; analytics without replay or person
 *   properties (a signed-in member by user id only), with PostHog's state
 *   back in memory and nothing left in the browser's
 *   storage. In an opt-in region (EU/EEA, UK, CH) forgetting the choice
 *   is a refusal, as for "denied".
 * - "analytics": like "granted", without session replay.
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

  const wasRunning = posthog.__loaded;
  if (!startAnalytics()) return;
  // A fresh start was configured from the new choice already.
  if (wasRunning) posthog.set_config({ persistence: persistenceFor(capabilities.storage) });
  moveIdentifiedUser(capabilities.storage);
  if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
  if (capabilities.sessionReplay) posthog.startSessionRecording();
  else posthog.stopSessionRecording();
}

/**
 * Which user this browser identified to PostHog: in localStorage with
 * explicit consent, otherwise only in memory for the life of the page (like
 * PostHog's own state then).
 */
const IDENTIFIED_USER_KEY = "iso_analytics_user";
let identifiedInMemory: string | null = null;

function storageAllowed(): boolean {
  return consentCapabilities(readBrowserConsent()).storage;
}

function readIdentifiedUser(): string | null {
  try {
    return window.localStorage.getItem(IDENTIFIED_USER_KEY) ?? identifiedInMemory;
  } catch {
    return identifiedInMemory;
  }
}

function rememberIdentifiedUser(userId: string): void {
  identifiedInMemory = userId;
  if (!storageAllowed()) return;
  try {
    window.localStorage.setItem(IDENTIFIED_USER_KEY, userId);
  } catch {
    // Without storage the reset on sign-out relies on the memory copy and,
    // after a reload, on PostHog's own check of a different id.
  }
}

function removeStoredIdentifiedUser(): void {
  try {
    window.localStorage.removeItem(IDENTIFIED_USER_KEY);
  } catch {
    // Storage is unavailable; nothing was stored.
  }
}

function forgetIdentifiedUser(): void {
  identifiedInMemory = null;
  removeStoredIdentifiedUser();
}

/** Puts the remembered user where the current consent allows it. */
function moveIdentifiedUser(storage: boolean): void {
  const userId = readIdentifiedUser();
  if (userId === null) return;
  identifiedInMemory = userId;
  if (!storage) {
    removeStoredIdentifiedUser();
    return;
  }
  try {
    window.localStorage.setItem(IDENTIFIED_USER_KEY, userId);
  } catch {
    // Kept in memory only.
  }
}


export type AnalyticsUser = { id: string };

/**
 * Ties PostHog's visitor to the signed-in user, or cuts the tie when nobody
 * is signed in any more.
 *
 * The distinct id is the user id, never the email address, and no name or
 * email is attached as a person property, whatever the consent. On sign-out
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

  // By id only, in every consent state: no name or email address is ever
  // sent to PostHog. A repeat call with the same id sends nothing.
  posthog.identify(user.id);

  rememberIdentifiedUser(user.id);
}

/** Reports an error caught by a React error boundary. No-op when stopped. */
export function captureBoundaryError(error: unknown, boundary: string): void {
  if (!posthog.__loaded) return;
  posthog.captureException(error, { boundary });
}
