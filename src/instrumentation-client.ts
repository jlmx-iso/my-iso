// Browser telemetry: the one place PostHog is initialised. Next.js loads
// this file in the browser before the app hydrates (the
// `instrumentation-client` convention).
//
// Everything is sent to the app's own origin (TELEMETRY_PROXY_PATH) and
// forwarded to PostHog from there, so the browser makes no third-party
// requests. Who the visitor is, is handled in ~/app/providers.

import posthog from "posthog-js";

import { consentCapabilities, readBrowserConsent } from "~/_lib/consent";
import { DEFAULT_POSTHOG_UI_HOST, TELEMETRY_PROXY_PATH } from "~/telemetryConfig";

// `process.env.NEXT_PUBLIC_*` is read directly (not through ~/env) so this
// entry stays free of the env schema and Zod; the values are inlined at
// build time.
const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY;

if (projectToken) {
  const capabilities = consentCapabilities(readBrowserConsent());

  posthog.init(projectToken, {
    api_host: TELEMETRY_PROXY_PATH,
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST ?? DEFAULT_POSTHOG_UI_HOST,
    defaults: "2026-08-30",

    // App Router: a $pageview on load and on every client-side navigation.
    capture_pageview: "history_change",
    // Uncaught errors and unhandled rejections go to error tracking.
    capture_exceptions: true,
    // Anonymous visitors do not create person profiles.
    person_profiles: "identified_only",

    // A refusal (cookie or Global Privacy Control) stops everything.
    opt_out_capturing_by_default: !capabilities.capture,
    // Whether replay records at all is a PostHog project setting; here it
    // additionally needs explicit consent, and never shows what is typed.
    disable_session_recording: !capabilities.sessionReplay,
    session_recording: { maskAllInputs: true },

    loaded: (instance) => {
      instance.register({ environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development" });
      // An earlier opt-in is stored by the SDK; a refusal made since then
      // (for example the browser's privacy signal being switched on) wins.
      if (!capabilities.capture) instance.opt_out_capturing();
    },
  });
}
