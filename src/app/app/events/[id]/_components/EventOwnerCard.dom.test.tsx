// @vitest-environment happy-dom
//
// Who posted an event: their name and Pro badge, a way to their profile and
// the "Message" control for everyone else; "Edit event" for the owner.

import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "~/test/dom/render";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import EventOwnerCard from "./EventOwnerCard";

const EVENT = {
  createdAt: new Date("2026-11-10T12:00:00.000Z"),
  date: "2027-03-14T16:00:00.000Z",
  description: "Ceremony and portraits",
  duration: 6,
  id: "ev-1",
  location: "Austin, TX",
  payCents: null,
  timeZone: "America/Chicago",
  photographer: { avatar: null, isPro: true, name: "Marcus Rivera", userId: "marcus" },
  title: "Spring wedding",
};

describe("EventOwnerCard", () => {
  it("names the poster with their Pro badge, and offers their profile and a message", () => {
    renderWithProviders(
      <EventOwnerCard event={EVENT} isOwner={false} messageAction={<button type="button">Message</button>} />,
    );
    const card = screen.getByRole("region", { name: "Lead photographer Marcus Rivera" });

    expect(within(card).getByText("Marcus Rivera")).toBeTruthy();
    // "Posted" once, not as an eyebrow as well.
    expect(within(card).getAllByText(/Posted/)).toHaveLength(1);
    expect(within(card).getByText("Pro member")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "View profile" }).getAttribute("href")).toBe("/app/photographer/marcus");
    expect(within(card).getByRole("button", { name: "Message" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Edit event" })).toBeNull();
  });

  it("offers the owner their profile and Edit event, not a message to themselves", () => {
    renderWithProviders(
      <EventOwnerCard
        event={{ ...EVENT, photographer: { ...EVENT.photographer, isPro: false } }}
        isOwner
        messageAction={<button type="button">Message</button>}
      />,
      { trpc: { google: { getAutocompleteLocations: () => [] } } },
    );
    const card = screen.getByRole("region", { name: "Your event Marcus Rivera" });

    expect(within(card).getByRole("link", { name: "Your profile" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Edit event" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Message" })).toBeNull();
    expect(within(card).queryByText("Pro member")).toBeNull();
  });
});
