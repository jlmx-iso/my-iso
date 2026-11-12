// @vitest-environment happy-dom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "~/test/dom/render";

import ConsentBanner from "./ConsentBanner";
import { choiceFor, openPrivacyChoices, preferencesFor } from "./privacyChoices";
import PrivacyChoicesLink from "./PrivacyChoicesLink";

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

function setGpc(value: boolean) {
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value });
}

const consentCookie = () =>
  document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("iso_consent="))
    ?.slice("iso_consent=".length) ?? null;

beforeEach(() => {
  clearCookies();
  setGpc(false);
  // Analytics are not configured in tests: choices are only recorded.
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PUBLIC_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.documentElement.removeAttribute("data-consent-region");
});

const banner = () => screen.queryByRole("region", { name: "Privacy choices" });
const liveRegion = () => document.querySelector(".sr-only[aria-live=polite]");

describe("ConsentBanner", () => {
  it("asks a visitor who has not chosen, with Accept and Decline side by side", async () => {
    renderWithProviders(<ConsentBanner optInRequired={false} />);
    const region = await screen.findByRole("region", { name: "Privacy choices" });

    const accept = within(region).getByRole("button", { name: "Accept analytics" });
    const decline = within(region).getByRole("button", { name: "Decline" });
    // Equal prominence: the same variant, colour and size.
    for (const attribute of ["data-variant", "data-size", "class"]) {
      expect(accept.getAttribute(attribute)).toBe(decline.getAttribute(attribute));
    }
    expect(within(region).getByRole("button", { name: "Choose" })).toBeTruthy();
    expect(within(region).getByText(/tied to a pseudonymous ID, never your name or email/)).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Privacy policy" }).getAttribute("href")).toBe("/privacy");
  });

  it("says nothing is measured before a yes in an opt-in region", async () => {
    renderWithProviders(<ConsentBanner optInRequired />);
    expect(await screen.findByText(/Nothing is measured until you accept/)).toBeTruthy();
  });

  it("records an acceptance and goes away", async () => {
    renderWithProviders(<ConsentBanner optInRequired />);
    await userEvent.click(await screen.findByRole("button", { name: "Accept analytics" }));
    expect(consentCookie()).toBe("analytics");
    expect(banner()).toBeNull();
  });

  it("records a refusal and goes away", async () => {
    renderWithProviders(<ConsentBanner optInRequired={false} />);
    await userEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(consentCookie()).toBe("denied");
    expect(banner()).toBeNull();
  });

  it("does not ask again once a choice is stored", async () => {
    document.cookie = "iso_consent=denied; Path=/";
    renderWithProviders(<ConsentBanner optInRequired={false} />);
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();
  });

  it("does not show at all with Global Privacy Control on (a refusal already)", async () => {
    setGpc(true);
    renderWithProviders(<ConsentBanner optInRequired={false} />);
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--consent-banner-h")).toBe("");
  });

  it("reserves its height at the bottom of the page while shown", async () => {
    renderWithProviders(<ConsentBanner optInRequired={false} />);
    await screen.findByRole("region", { name: "Privacy choices" });
    expect(document.documentElement.style.getPropertyValue("--consent-banner-h")).toMatch(/^\d+px$/);
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(document.documentElement.style.getPropertyValue("--consent-banner-h")).toBe("");
  });

  it("announces the choice and moves focus to the main content", async () => {
    renderWithProviders(
      <>
        <main id="main-content" tabIndex={-1} />
        <ConsentBanner optInRequired={false} />
      </>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Accept analytics" }));
    await waitFor(() => expect(liveRegion()?.textContent).toBe("Privacy choices saved"));
    await waitFor(() => expect(document.activeElement?.id).toBe("main-content"));
    // No toast for a choice made in the banner itself.
    expect(screen.queryByText("They apply on this browser from now on.")).toBeNull();
  });
});

describe("privacy preferences", () => {
  it("opens from Choose, starts from what is in effect, and saves analytics without replay", async () => {
    renderWithProviders(<ConsentBanner optInRequired={false} />);
    await userEvent.click(await screen.findByRole("button", { name: "Choose" }));

    const dialog = screen.getByRole("dialog", { name: "Privacy choices" });
    const analytics = within(dialog).getByRole<HTMLInputElement>("switch", { name: /Analytics/ });
    const replay = within(dialog).getByRole<HTMLInputElement>("switch", { name: /Session replay/ });
    // Outside the opt-in regions pseudonymous analytics run until a choice.
    expect(analytics.checked).toBe(true);
    expect(replay.checked).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Save choices" }));
    expect(consentCookie()).toBe("analytics");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(banner()).toBeNull();
  });

  it("turns session replay on only with analytics, and off with them", async () => {
    document.documentElement.setAttribute("data-consent-region", "opt-in");
    renderWithProviders(<ConsentBanner optInRequired />);
    await userEvent.click(await screen.findByRole("button", { name: "Choose" }));
    const dialog = screen.getByRole("dialog", { name: "Privacy choices" });
    const analytics = within(dialog).getByRole<HTMLInputElement>("switch", { name: /Analytics/ });
    const replay = within(dialog).getByRole<HTMLInputElement>("switch", { name: /Session replay/ });

    // Nothing is pre-ticked where an opt-in is required.
    expect(analytics.checked).toBe(false);
    expect(replay.disabled).toBe(true);

    await userEvent.click(analytics);
    await userEvent.click(replay);
    expect(replay.checked).toBe(true);
    await userEvent.click(analytics);
    expect(replay.checked).toBe(false);
    await userEvent.click(analytics);
    await userEvent.click(replay);

    await userEvent.click(within(dialog).getByRole("button", { name: "Save choices" }));
    expect(consentCookie()).toBe("granted");
  });

  it("can be cancelled without recording anything, and focus returns to Choose", async () => {
    renderWithProviders(<ConsentBanner optInRequired={false} />);
    const choose = await screen.findByRole("button", { name: "Choose" });
    await userEvent.click(choose);
    // The banner stays mounted behind the dialog, out of reach.
    expect(document.querySelector("section[inert]")).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("switch", { name: /Analytics/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(consentCookie()).toBeNull();
    expect(await screen.findByRole("region", { name: "Privacy choices" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(choose));
  });

  it("says why session replay cannot be switched on while analytics are off", async () => {
    document.documentElement.setAttribute("data-consent-region", "opt-in");
    renderWithProviders(<ConsentBanner optInRequired />);
    await userEvent.click(await screen.findByRole("button", { name: "Choose" }));
    expect(screen.getByText(/Turn on analytics to use this./)).toBeTruthy();
    await userEvent.click(screen.getByRole("switch", { name: /Analytics/ }));
    expect(screen.queryByText(/Turn on analytics to use this./)).toBeNull();
  });

  it("reopens from the Privacy choices link, after a choice, and can withdraw it", async () => {
    document.cookie = "iso_consent=granted; Path=/";
    renderWithProviders(
      <>
        <PrivacyChoicesLink />
        <ConsentBanner optInRequired={false} />
      </>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Privacy choices" }));
    const dialog = screen.getByRole("dialog", { name: "Privacy choices" });
    const analytics = within(dialog).getByRole<HTMLInputElement>("switch", { name: /Analytics/ });
    expect(analytics.checked).toBe(true);
    expect((within(dialog).getByRole<HTMLInputElement>("switch", { name: /Session replay/ })).checked).toBe(true);

    await userEvent.click(analytics);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save choices" }));
    expect(consentCookie()).toBe("denied");
    // Saved from the footer: a toast says so, and the live region too.
    expect(await screen.findByText("They apply on this browser from now on.")).toBeTruthy();
    await waitFor(() => expect(liveRegion()?.textContent).toBe("Privacy choices saved"));
  });

  it("announces a second save in a row again", async () => {
    renderWithProviders(
      <>
        <PrivacyChoicesLink />
        <ConsentBanner optInRequired={false} />
      </>,
    );
    for (let save = 0; save < 2; save++) {
      await userEvent.click(await screen.findByRole("button", { name: "Privacy choices" }));
      await userEvent.click(screen.getByRole("button", { name: "Save choices" }));
      // Emptied first, then filled: a screen reader hears it each time.
      expect(liveRegion()?.textContent).toBe("");
      await waitFor(() => expect(liveRegion()?.textContent).toBe("Privacy choices saved"));
    }
  });

  it("opens from the Settings button too", async () => {
    renderWithProviders(
      <>
        <PrivacyChoicesLink variant="button" />
        <ConsentBanner optInRequired={false} />
      </>,
    );
    const buttons = await screen.findAllByRole("button", { name: "Privacy choices" });
    await userEvent.click(buttons[0]!);
    expect(screen.getByRole("dialog", { name: "Privacy choices" })).toBeTruthy();
  });

  it("with Global Privacy Control, explains it and keeps everything off", async () => {
    setGpc(true);
    document.cookie = "iso_consent=denied; Path=/";
    renderWithProviders(<ConsentBanner optInRequired={false} />);
    await act(() => Promise.resolve());
    act(() => openPrivacyChoices());

    const dialog = screen.getByRole("dialog", { name: "Privacy choices" });
    expect(within(dialog).getByRole("note").textContent).toMatch(/Global Privacy Control/);
    for (const name of [/Analytics/, /Session replay/]) {
      const toggle = within(dialog).getByRole<HTMLInputElement>("switch", { name });
      expect(toggle.checked).toBe(false);
      expect(toggle.disabled).toBe(true);
    }
    expect(within(dialog).queryByRole("button", { name: "Save choices" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("preferencesFor / choiceFor", () => {
  it("map consent states and switches both ways", () => {
    expect(preferencesFor("granted")).toEqual({ analytics: true, sessionReplay: true });
    expect(preferencesFor("analytics")).toEqual({ analytics: true, sessionReplay: false });
    expect(preferencesFor("unknown")).toEqual({ analytics: true, sessionReplay: false });
    expect(preferencesFor("denied")).toEqual({ analytics: false, sessionReplay: false });
    expect(choiceFor({ analytics: false, sessionReplay: true })).toBe("denied");
    expect(choiceFor({ analytics: true, sessionReplay: false })).toBe("analytics");
    expect(choiceFor({ analytics: true, sessionReplay: true })).toBe("granted");
  });
});
