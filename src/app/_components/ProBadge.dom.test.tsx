// @vitest-environment happy-dom
//
// Where Pro shows up for other people and for the member: the badge next to
// a name (and nowhere for members without Pro), told apart from the neutral
// role chip on a profile; the plan's list of benefits; and the account
// menu's links to insights and to help.

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PRO_PLAN } from "~/_utils/plans";
import { renderWithProviders } from "~/test/dom/render";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));
vi.mock("next-auth/react", () => import("~/test/dom/session"));

import { AccountDropdown } from "./nav/AccountMenu";
import ProFeatures, { ComingSoon } from "./plans/ProFeatures";
import { ProBadge } from "./ProBadge";
import ProfileHeader from "./profiles/ProfileHeader";
import UserBadge from "./UserBadge";

const PHOTOGRAPHER = {
  avatar: null,
  bio: null,
  companyName: "Olive Studio",
  facebook: null,
  instagram: null,
  location: "Austin, TX",
  name: "Olive Park",
  tiktok: null,
  twitter: null,
  vimeo: null,
  website: null,
  youtube: null,
};

describe("ProBadge", () => {
  it("reads 'Pro' as written, is announced as 'Pro member', and has no tooltip title", () => {
    renderWithProviders(<ProBadge />);
    const badge = screen.getByTestId("pro-badge");
    expect(badge.textContent).toBe("ProPro member");
    expect(within(badge).getByText("Pro").getAttribute("aria-hidden")).toBe("true");
    expect(badge.getAttribute("title")).toBeNull();
    expect(badge.querySelector("[title]")).toBeNull();
    // Not upper-cased like other badges.
    expect(badge.getAttribute("style") ?? "").toContain("text-transform: none");
  });

  it("follows a Pro member's name, and only theirs", () => {
    renderWithProviders(
      <>
        <UserBadge user={{ isPro: true, name: "Olive Park", userId: "u1" }} />
        <UserBadge user={{ name: "Ben Free", userId: "u2" }} />
      </>,
    );
    expect(screen.getAllByTestId("pro-badge")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Olive Park" }).parentElement?.textContent).toContain("Pro member");
  });
});

describe("ProfileHeader", () => {
  it("shows the Pro badge apart from the neutral role chip", () => {
    renderWithProviders(<ProfileHeader photographer={{ ...PHOTOGRAPHER, isPro: true }} />);
    const badge = screen.getByTestId("pro-badge");
    const role = screen.getByText("Photographer").closest(".mantine-Badge-root");
    expect(role).not.toBeNull();
    expect(role).not.toBe(badge);
    // The crown badge is orange; the role chip is gray.
    expect(badge.getAttribute("style") ?? "").toContain("orange");
    expect(role?.getAttribute("style") ?? "").toContain("gray");
  });

  it("shows no badge for a member without Pro, and the footer under the links", () => {
    renderWithProviders(<ProfileHeader photographer={PHOTOGRAPHER} footer={<a href="/app/insights">12 profile views</a>} />);
    expect(screen.queryByTestId("pro-badge")).toBeNull();
    expect(screen.getByRole("link", { name: "12 profile views" })).toBeTruthy();
  });
});

describe("ProFeatures", () => {
  it("lists every current benefit, the plan's wording included", () => {
    renderWithProviders(<ProFeatures pricing={{ isFoundingPrice: false }} />);
    const list = screen.getByTestId("pro-features");
    for (const feature of PRO_PLAN.features) expect(within(list).getByText(feature)).toBeTruthy();
    expect(within(list).getByText("Shown first among equally relevant search results")).toBeTruthy();
    expect(within(list).getByText("Insights: profile views, where they came from, applications")).toBeTruthy();
    // Nothing is planned: no "Coming soon" heading.
    expect(screen.queryByTestId("pro-features-coming-soon")).toBeNull();
  });

  it("names the founding price's benefit for a founding price", () => {
    renderWithProviders(<ProFeatures pricing={{ isFoundingPrice: true }} />);
    expect(screen.getByText(PRO_PLAN.foundingFeature)).toBeTruthy();
  });

  it("puts planned items under their own heading, never as a benefit", () => {
    renderWithProviders(<ComingSoon features={["Calendar sync"]} />);
    const soon = screen.getByTestId("pro-features-coming-soon");
    expect(within(soon).getByText("Coming soon")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Coming soon" })).getByText("Calendar sync")).toBeTruthy();
  });
});

describe("AccountDropdown", () => {
  it("links to insights and to help, after the member's other pages", async () => {
    renderWithProviders(<AccountDropdown user={{ name: "Olive Park" }} unreadCount={0} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    const nav = await screen.findByRole("navigation", { name: "Account" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toContain("/app/insights");
    expect(links.at(-1)?.getAttribute("href")).toBe("/app/support");
    expect(within(nav).getByRole("link", { name: "Help & support" })).toBeTruthy();
  });

  it("keeps the waitlist admin entry last for those who manage it", async () => {
    renderWithProviders(<AccountDropdown user={{ canManageWaitlist: true, name: "Founder" }} unreadCount={0} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    const links = within(await screen.findByRole("navigation", { name: "Account" })).getAllByRole("link");
    expect(links.slice(-2).map((link) => link.getAttribute("href"))).toEqual(["/app/support", "/app/admin/waitlist"]);
  });
});
