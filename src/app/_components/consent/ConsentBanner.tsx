"use client";

import { Anchor, Button, Group, Modal, Paper, Stack, Switch, Text, Title } from "@mantine/core";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  hasGlobalPrivacyControl,
  readBrowserConsent,
  readConsentChoice,
  setAnalyticsConsent,
} from "~/_lib/analyticsBrowser";
import type { ConsentChoice } from "~/_lib/consent";
import { NextLink } from "~/app/_components/NextLink";
import { notify } from "~/app/_lib/notify";

import classes from "./ConsentBanner.module.css";
import {
  choiceFor,
  preferencesFor,
  PRIVACY_CHOICES_EVENT,
  type PrivacyPreferences,
} from "./privacyChoices";

type Props = {
  /** The visitor is in a region where analytics wait for a yes (see consentRequiresOptIn). */
  optInRequired: boolean;
};

type Snapshot = { choice: ConsentChoice | null; gpc: boolean };

/** Fired after this page records a choice, so the banner re-reads the cookie. */
const CONSENT_CHANGED_EVENT = "iso:consent-changed";

/** CSS variable on <html> with the banner's height, so the page can make room for it. */
export const BANNER_HEIGHT_VARIABLE = "--consent-banner-h";

export const SAVED_MESSAGE = "Privacy choices saved";

function subscribeToConsent(onChange: () => void): () => void {
  window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
}

/** A string, so that an unchanged state compares equal between reads. */
function readSnapshot(): string {
  return `${readConsentChoice() ?? ""}|${hasGlobalPrivacyControl() ? "gpc" : ""}`;
}

function parseSnapshot(value: string | null): Snapshot | null {
  if (value === null) return null;
  const [choice = "", gpc] = value.split("|");
  return { choice: choice === "" ? null : (choice as ConsentChoice), gpc: gpc === "gpc" };
}

/** Moves focus to the page's main content once the banner has gone. */
function focusMainContent(): void {
  setTimeout(() => document.getElementById("main-content")?.focus(), 0);
}

/**
 * Keeps BANNER_HEIGHT_VARIABLE on <html> equal to the banner's height while
 * it is shown, so the bottom of the page can scroll clear of it.
 */
function useReservedHeight(element: HTMLElement | null): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!element) {
      root.style.removeProperty(BANNER_HEIGHT_VARIABLE);
      return;
    }
    const update = () => root.style.setProperty(BANNER_HEIGHT_VARIABLE, `${Math.ceil(element.offsetHeight)}px`);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(BANNER_HEIGHT_VARIABLE);
    };
  }, [element]);
}

/**
 * The consent banner and the privacy preferences dialog.
 *
 * The banner shows while no choice has been made, unless the browser sends
 * a Global Privacy Control signal (a refusal already; the dialog explains
 * it). It does not block the page, and "Accept analytics" and "Decline" are
 * the same size and style. "Choose" opens the preferences, which the
 * footer's "Privacy choices" link and Settings also open
 * (PRIVACY_CHOICES_EVENT). A choice is stored in the consent cookie and
 * applied to the running SDK at once (`setAnalyticsConsent`).
 *
 * Focus: while the dialog is open the banner stays mounted (inert), so
 * closing the dialog returns focus to "Choose"; once a choice is made from
 * the banner, focus moves to the main content. Every save is announced.
 *
 * Nothing renders on the server: the choice lives in a cookie the browser
 * reads, and rendering only after mount keeps hydration consistent.
 */
export default function ConsentBanner({ optInRequired }: Props) {
  const snapshot = parseSnapshot(useSyncExternalStore(subscribeToConsent, readSnapshot, () => null));
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [bannerElement, setBannerElement] = useState<HTMLElement | null>(null);
  const openedFromBanner = useRef(false);

  useEffect(() => {
    const open = () => {
      openedFromBanner.current = false;
      setPreferencesOpen(true);
    };
    window.addEventListener(PRIVACY_CHOICES_EVENT, open);
    return () => window.removeEventListener(PRIVACY_CHOICES_EVENT, open);
  }, []);

  const showBanner = snapshot !== null && snapshot.choice === null && !snapshot.gpc;
  useReservedHeight(showBanner ? bannerElement : null);

  const choose = useCallback(
    (choice: ConsentChoice, source: "banner" | "dialog") => {
      const bannerWasShown = showBanner;
      setAnalyticsConsent(choice);
      window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
      setPreferencesOpen(false);
      // Cleared first, so a second save in a row is announced again.
      setAnnouncement("");
      setTimeout(() => setAnnouncement(SAVED_MESSAGE), 100);
      if (source === "dialog" && !openedFromBanner.current) {
        // From the footer or Settings: say so where the person is.
        notify.success({ message: "They apply on this browser from now on.", title: SAVED_MESSAGE });
      }
      // The banner (and the button that opened the dialog) is gone.
      if (bannerWasShown) focusMainContent();
    },
    [showBanner],
  );

  if (!snapshot) return null;

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {showBanner && (
        <Paper
          ref={setBannerElement}
          component="section"
          aria-labelledby="consent-banner-title"
          className={classes.banner}
          // Kept in place while the dialog is open, so focus can return here.
          inert={preferencesOpen}
          aria-hidden={preferencesOpen || undefined}
          shadow="md"
          radius="md"
          p="md"
          withBorder
        >
          <Stack gap="sm">
            <Title order={2} size="h5" id="consent-banner-title">
              Privacy choices
            </Title>
            <Text size="sm">
              {optInRequired
                ? "ISO can count which pages and features are used so we can improve the app. Nothing is measured until you accept; reports of errors on our servers are still sent, without anything that identifies you."
                : "ISO counts which pages and features are used so we can improve the app. It's tied to a pseudonymous ID, never your name or email."}{" "}
              Session replay is only on if you switch it on.{" "}
              <Anchor component={NextLink} href="/privacy" size="sm">
                Privacy policy
              </Anchor>
            </Text>
            {/* Accept and Decline: the same size, side by side (classes.actions). */}
            <div className={classes.actions}>
              <Button size="sm" variant="filled" color="dark" onClick={() => choose("analytics", "banner")}>
                Accept analytics
              </Button>
              <Button size="sm" variant="filled" color="dark" onClick={() => choose("denied", "banner")}>
                Decline
              </Button>
              <Button
                size="sm"
                variant="default"
                className={classes.choose}
                onClick={() => {
                  openedFromBanner.current = true;
                  setPreferencesOpen(true);
                }}
              >
                Choose
              </Button>
            </div>
          </Stack>
        </Paper>
      )}

      <Modal opened={preferencesOpen} onClose={() => setPreferencesOpen(false)} title="Privacy choices" centered>
        {preferencesOpen && (
          <PreferencesForm
            gpc={snapshot.gpc}
            onCancel={() => setPreferencesOpen(false)}
            onSave={(choice) => choose(choice, "dialog")}
          />
        )}
      </Modal>
    </>
  );
}

function PreferencesForm({
  gpc,
  onCancel,
  onSave,
}: {
  gpc: boolean;
  onCancel: () => void;
  onSave: (choice: ConsentChoice) => void;
}) {
  // Starts from what is in effect now, so the switches never claim
  // something is off that is running (or the reverse).
  const [preferences, setPreferences] = useState<PrivacyPreferences>(() =>
    preferencesFor(readBrowserConsent()),
  );
  const replayDescription =
    "A recording of clicks and page changes. All text, everything you type and every photo are hidden in it.";

  return (
    <Stack gap="md">
      {gpc && (
        <Text size="sm" role="note">
          Your browser sends a Global Privacy Control signal. ISO treats it as a refusal, so
          analytics and session replay stay off on this browser.
        </Text>
      )}
      <Switch
        label="Analytics"
        description="Which pages and features are used, and errors, so we can fix and improve ISO. Never your name or email, never sold."
        checked={preferences.analytics}
        disabled={gpc}
        data-autofocus
        onChange={(event) => {
          const analytics = event.currentTarget.checked;
          setPreferences((current) => ({
            analytics,
            sessionReplay: analytics && current.sessionReplay,
          }));
        }}
      />
      <Switch
        label="Session replay"
        description={
          !gpc && !preferences.analytics ? `${replayDescription} Turn on analytics to use this.` : replayDescription
        }
        checked={preferences.sessionReplay}
        disabled={gpc || !preferences.analytics}
        onChange={(event) => {
          const sessionReplay = event.currentTarget.checked;
          setPreferences((current) => ({ ...current, sessionReplay }));
        }}
      />
      <Text size="xs" c="dimmed">
        Sign-in and security cookies are always on: ISO does not work without them.
      </Text>
      <Group justify="flex-end" gap="xs">
        {gpc ? (
          <Button variant="filled" color="dark" onClick={onCancel}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="filled" color="dark" onClick={() => onSave(choiceFor(preferences))}>
              Save choices
            </Button>
          </>
        )}
      </Group>
    </Stack>
  );
}
