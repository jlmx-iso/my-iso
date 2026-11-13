// @vitest-environment happy-dom
//
// The app's navigation, header links and phone tab bar: the current page is
// marked, and Messages carries how many conversations have something new
// (in its accessible name too). The signed-out header has no Messages link
// and does not ask the server.

import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders } from "~/test/dom/render";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import BottomTabBar from "./BottomTabBar";
import NavLinks from "./NavLinks";

const unread = (unreadThreads: number) => ({ message: { getUnreadCount: () => ({ unreadMessages: unreadThreads * 2, unreadThreads }) } });

const APP_LINKS = [
  { href: "/app/events", label: "Events" },
  { href: "/app/messages", label: "Messages" },
];

describe("NavLinks", () => {
  it("marks the current section and badges Messages with the unread conversations", async () => {
    testRouter.setLocation("/app/events/ev-1");
    const view = renderWithProviders(<NavLinks links={APP_LINKS} />, { trpc: unread(3) });
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));

    expect(nav.getByRole("link", { name: "Events" }).getAttribute("aria-current")).toBe("page");
    const messages = await nav.findByRole("link", { name: /^Messages.*, 3 unread conversations$/ });
    expect(messages.hasAttribute("aria-current")).toBe(false);
    expect(within(messages).getByTestId("nav-unread").textContent).toBe("3, 3 unread conversations");
    expect(view.callsTo("message.getUnreadCount")).toEqual([undefined]);
  });

  it("shows no badge with nothing unread", async () => {
    testRouter.setLocation("/app/messages");
    const view = renderWithProviders(<NavLinks links={APP_LINKS} />, { trpc: unread(0) });
    await vi.waitFor(() => expect(view.callsTo("message.getUnreadCount")).toHaveLength(1));
    expect(screen.getByRole("link", { name: "Messages" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByTestId("nav-unread")).toBeNull();
  });

  it("never marks an in-page link, and asks nothing without a Messages link", () => {
    testRouter.setLocation("/");
    const view = renderWithProviders(
      <NavLinks links={[{ href: "/#features", label: "Features" }, { href: "/login", label: "Sign in" }]} />,
    );
    expect(screen.getByRole("link", { name: "Features" }).hasAttribute("aria-current")).toBe(false);
    expect(view.calls).toEqual([]);
  });
});

describe("BottomTabBar", () => {
  it("marks the current tab and badges Messages, capped at 99+", async () => {
    testRouter.setLocation("/app/bookings");
    renderWithProviders(<BottomTabBar />, { trpc: unread(120) });
    const bar = within(screen.getByRole("navigation", { name: "Tab bar" }));

    expect(bar.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/app/events",
      "/app/discover",
      "/app/messages",
      "/app/bookings",
      "/app/profile",
    ]);
    expect(bar.getByRole("link", { name: "Bookings" }).getAttribute("aria-current")).toBe("page");
    expect(await bar.findByRole("link", { name: /^Messages.*, 120 unread conversations$/ })).toBeTruthy();
    expect(bar.getByTestId("tab-unread").textContent).toBe("99+");
  });
});
