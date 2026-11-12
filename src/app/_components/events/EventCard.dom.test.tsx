// @vitest-environment happy-dom
//
// A feed card reads in the order people decide: the day (a date tile in the
// event's zone), the title, then time with its zone, place, length and pay,
// then who posted it. An event without a zone is shown in the reader's.

import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "~/test/dom/render";

import EventCard, { type FeedEvent } from "./EventCard";

const NOW = new Date("2026-11-12T12:00:00.000Z");

function feedEvent(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    commentCount: 2,
    createdAt: new Date("2026-11-10T12:00:00.000Z"),
    // 2 PM in Denver.
    date: new Date("2026-11-22T21:00:00.000Z"),
    description: "Sunrise elopement in the park",
    duration: 6,
    id: "ev-1",
    image: null,
    isDeleted: false,
    isFulfilled: false,
    location: "Estes Park, CO",
    payCents: 45_000,
    photographer: { avatar: null, isPro: true, name: "Marcus Rivera", userId: "marcus" },
    photographerId: "ph-marcus",
    timeZone: "America/Denver",
    title: "Sunrise elopement",
    updatedAt: new Date("2026-11-10T12:00:00.000Z"),
    ...overrides,
  };
}

function renderCard(event: FeedEvent, now = NOW) {
  return renderWithProviders(
    <EventCard event={event} application={undefined} currentUserId="me" now={now} />,
  );
}

describe("EventCard", () => {
  it("shows the day, time with its zone, place, length and pay", () => {
    renderCard(feedEvent());
    const card = screen.getByRole("article");

    const tile = within(card).getByTestId("date-tile");
    expect(tile.textContent).toBe("Nov22Sun");
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    const meta = within(card).getByTestId("event-meta");
    expect(meta.textContent).toContain("Starts: 2:00 PM MST");
    expect(meta.textContent).toContain("Location: Estes Park, CO");
    expect(meta.textContent).toContain("Duration: 6 hours");
    expect(meta.textContent).toContain("Pay: $450");
    expect(within(card).getByRole("link", { name: "Sunrise elopement" }).getAttribute("href")).toBe("/app/events/ev-1");
    expect(within(card).getByText("Pro member")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Comment on Sunrise elopement, 2 comments" })).toBeTruthy();
    expect(within(card).queryByText("Past event")).toBeNull();
  });

  it("leaves pay out when it is not listed, and uses the reader's zone without an event zone", () => {
    renderCard(feedEvent({ payCents: null, timeZone: null }));
    const meta = screen.getByTestId("event-meta");

    expect(meta.textContent).not.toContain("Pay");
    // The tests run in UTC.
    expect(meta.textContent).toContain("9:00 PM UTC");
  });

  it("marks an event that has started", () => {
    renderCard(feedEvent(), new Date("2026-11-23T00:00:00.000Z"));

    expect(screen.getByText("Past event")).toBeTruthy();
  });
});
