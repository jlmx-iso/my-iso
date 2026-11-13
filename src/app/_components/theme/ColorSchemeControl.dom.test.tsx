// @vitest-environment happy-dom
//
// The System / Light / Dark control, inside the app's real ThemeProvider and
// Mantine's default localStorage manager: each option applies the scheme to
// <html> and stores it under the key the root layout's ColorSchemeScript
// reads (and the privacy policy lists), the stored choice is shown, the
// keyboard works, and server HTML hydrates with a stored choice without a
// mismatch (a mismatch is a console.error, which fails a strict DOM test).

import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Footer } from "~/app/_components/Footer";
import { AccountDrawer, AccountDropdown } from "~/app/_components/nav/AccountMenu";
import AppearanceSettings from "~/app/app/settings/_components/AppearanceSettings";
import { ThemeProvider } from "~/app/theme/ThemeProvider";
import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders } from "~/test/dom/render";

import { ColorSchemeControl } from "./ColorSchemeControl";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));
vi.mock("next-auth/react", () => import("~/test/dom/session"));

const STORAGE_KEY = "mantine-color-scheme-value";

function renderControl(ui = <ColorSchemeControl />) {
  return renderWithProviders(<ThemeProvider>{ui}</ThemeProvider>);
}

function radio(name: "System" | "Light" | "Dark") {
  return screen.getByRole<HTMLInputElement>("radio", { name });
}

const htmlScheme = () => document.documentElement.getAttribute("data-mantine-color-scheme");

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-mantine-color-scheme");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("ColorSchemeControl", () => {
  it("is a radio group named Appearance with System, Light and Dark, System chosen by default", () => {
    renderControl();
    const group = screen.getByRole("radiogroup", { name: "Appearance" });
    expect(within(group).getAllByRole("radio").map((input) => input.getAttribute("value"))).toEqual(["auto", "light", "dark"]);
    expect(radio("System").checked).toBe(true);
    expect(radio("Light").checked).toBe(false);
    expect(radio("Dark").checked).toBe(false);
    // The system setting (light in happy-dom) applies.
    expect(htmlScheme()).toBe("light");
  });

  it("shows the stored choice", () => {
    window.localStorage.setItem(STORAGE_KEY, "dark");
    renderControl();
    expect(radio("Dark").checked).toBe(true);
    expect(radio("System").checked).toBe(false);
    expect(htmlScheme()).toBe("dark");
  });

  it("each option sets the scheme on <html> and stores it", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByText("Dark"));
    expect(radio("Dark").checked).toBe(true);
    expect(htmlScheme()).toBe("dark");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");

    await user.click(screen.getByText("Light"));
    expect(radio("Light").checked).toBe(true);
    expect(radio("Dark").checked).toBe(false);
    expect(htmlScheme()).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");

    await user.click(screen.getByText("Dark"));
    await user.click(screen.getByText("System"));
    expect(radio("System").checked).toBe(true);
    // System follows the device again (light here).
    expect(htmlScheme()).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("auto");
  });

  it("works from the keyboard: Tab reaches the chosen option, arrow keys change it", async () => {
    const user = userEvent.setup();
    renderControl(
      <>
        <button type="button">Before</button>
        <ColorSchemeControl />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Before" }));
    await user.tab();
    expect(document.activeElement).toBe(radio("System"));

    await user.keyboard("{ArrowRight}");
    expect(radio("Light").checked).toBe(true);
    expect(document.activeElement).toBe(radio("Light"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");

    await user.keyboard("{ArrowRight}");
    expect(radio("Dark").checked).toBe(true);
    expect(htmlScheme()).toBe("dark");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");

    await user.keyboard("{ArrowLeft}");
    expect(radio("Light").checked).toBe(true);
    expect(htmlScheme()).toBe("light");
  });

  it("follows a choice made in another tab", () => {
    renderControl();
    act(() => {
      window.localStorage.setItem(STORAGE_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "dark", storageArea: window.localStorage }));
    });
    expect(radio("Dark").checked).toBe(true);
    expect(htmlScheme()).toBe("dark");
  });

  it("hydrates server HTML without a mismatch when a choice is stored, then shows it", async () => {
    const ui = (
      <ThemeProvider>
        <ColorSchemeControl />
      </ThemeProvider>
    );
    // The server knows no stored choice: nothing is checked in its HTML.
    const container = document.createElement("div");
    container.innerHTML = renderToString(ui);
    document.body.append(container);
    expect(container.querySelectorAll("input:checked")).toHaveLength(0);

    // The browser has one; ColorSchemeScript has already applied it.
    window.localStorage.setItem(STORAGE_KEY, "dark");
    document.documentElement.setAttribute("data-mantine-color-scheme", "dark");
    const root = await act(async () => hydrateRoot(container, ui));

    expect(within(container).getByRole<HTMLInputElement>("radio", { name: "Dark" }).checked).toBe(true);
    expect(htmlScheme()).toBe("dark");
    act(() => root.unmount());
    container.remove();
  });
});

describe("where the control appears", () => {
  it("in Settings, under Appearance", () => {
    renderControl(<AppearanceSettings />);
    expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeTruthy();
  });

  it("in the marketing footer, for visitors who are not signed in", async () => {
    const user = userEvent.setup();
    renderControl(<Footer />);
    const footer = screen.getByRole("contentinfo");
    const group = within(footer).getByRole("radiogroup", { name: "Appearance" });
    await user.click(within(group).getByText("Dark"));
    expect(htmlScheme()).toBe("dark");
  });

  it("in the desktop account menu", async () => {
    const user = userEvent.setup();
    testRouter.setLocation("/app/events");
    // Mantine's test mode (renderWithProviders alone): a popover is not
    // hidden for want of a layout in happy-dom.
    renderWithProviders(<AccountDropdown user={{ name: "Olive Park" }} unreadCount={0} />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    const group = await screen.findByRole("radiogroup", { name: "Appearance" });
    await user.click(within(group).getByText("Dark"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(htmlScheme()).toBe("dark");
  });

  it("in the phone account sheet", async () => {
    const user = userEvent.setup();
    testRouter.setLocation("/app/events");
    renderControl(<AccountDrawer user={{ name: "Olive Park" }} unreadCount={0} />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    const sheet = await screen.findByRole("dialog", { name: "Account" });
    await user.click(within(within(sheet).getByRole("radiogroup", { name: "Appearance" })).getByText("Dark"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });
});
