// Opening the privacy preferences from anywhere: the footer link and the
// Settings button dispatch one DOM event; the consent banner (mounted once,
// in the root layout) listens for it. No shared React state is needed, so
// a server-rendered footer can hold the link.

import type { ConsentState } from "~/_lib/consent";

export const PRIVACY_CHOICES_EVENT = "iso:privacy-choices";

/** Opens the privacy preferences dialog. */
export function openPrivacyChoices(): void {
  window.dispatchEvent(new Event(PRIVACY_CHOICES_EVENT));
}

/** What the two switches in the preferences dialog stand for. */
export type PrivacyPreferences = { analytics: boolean; sessionReplay: boolean };

/** The switches' starting position for the consent now in effect. */
export function preferencesFor(state: ConsentState): PrivacyPreferences {
  return {
    analytics: state !== "denied",
    sessionReplay: state === "granted",
  };
}

/** The choice the switches describe. Replay without analytics is not a thing. */
export function choiceFor(preferences: PrivacyPreferences): "granted" | "analytics" | "denied" {
  if (!preferences.analytics) return "denied";
  return preferences.sessionReplay ? "granted" : "analytics";
}
