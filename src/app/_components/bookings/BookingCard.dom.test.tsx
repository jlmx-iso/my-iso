// @vitest-environment happy-dom
//
// The booking card's clock (useNowAtBoundaries): a card left open re-renders
// when the event starts and when it ends, so its buttons follow the server's
// rules (bookingTransitions.ts) without a reload and without a ticking timer.

import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "~/test/dom/render";

import BookingCard from "./BookingCard";

const NOW = new Date("2030-06-01T12:00:00Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const USER = { firstName: "Bea", id: "bea", lastName: "Cole", profilePic: null };

function renderCard(options: {
  duration?: number;
  payCents?: number | null;
  startsIn: number;
  status: string;
  timeZone?: string | null;
  variant: "sent" | "received";
}) {
  return renderWithProviders(
    <BookingCard
      booking={{ createdAt: NOW, id: "bk-1", notes: null, ownerNotes: null, rate: null, status: options.status }}
      event={{
        date: new Date(NOW.getTime() + options.startsIn),
        duration: options.duration ?? 2,
        id: "ev-1",
        location: "Austin, TX",
        payCents: options.payCents ?? null,
        timeZone: options.timeZone ?? null,
        title: "Garden wedding",
      }}
      user={USER}
      variant={options.variant}
    />,
    { trpc: { booking: { updateStatus: () => ({ success: true }) as never } } },
  );
}

const button = (name: string) => screen.queryByRole("button", { name });

/** Moves the clock and runs the timers that came due, as React work. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BookingCard clock", () => {
  it("drops Accept for the owner when the event starts, keeping Decline", async () => {
    renderCard({ startsIn: HOUR, status: "applied", variant: "received" });
    expect(button("Accept")).not.toBeNull();
    expect(button("Decline")).not.toBeNull();

    await advance(HOUR - MINUTE);
    expect(button("Accept")).not.toBeNull();

    await advance(MINUTE);
    expect(button("Accept")).toBeNull();
    expect(button("Decline")).not.toBeNull();
  });

  it("takes the applicant from Cancel booking, to nothing while it runs, to Mark as completed when it ends", async () => {
    renderCard({ duration: 3, startsIn: HOUR, status: "accepted", variant: "sent" });
    expect(button("Cancel booking")).not.toBeNull();
    expect(button("Mark as completed")).toBeNull();

    await advance(HOUR);
    expect(button("Cancel booking")).toBeNull();
    expect(button("Mark as completed")).toBeNull();

    await advance(3 * HOUR - MINUTE);
    expect(button("Mark as completed")).toBeNull();

    await advance(MINUTE);
    expect(button("Mark as completed")).not.toBeNull();
  });

  it("waits out an event more than 24.8 days away (longer than one timeout) without firing early", async () => {
    const startsIn = 40 * 24 * HOUR;
    renderCard({ startsIn, status: "applied", variant: "received" });

    await advance(30 * 24 * HOUR);
    expect(button("Accept")).not.toBeNull();

    await advance(startsIn - 30 * 24 * HOUR);
    expect(button("Accept")).toBeNull();
  });

  it("keeps no timer once both moments have passed or the card is gone", async () => {
    const view = renderCard({ duration: 1, startsIn: HOUR, status: "accepted", variant: "received" });
    await advance(2 * HOUR);
    expect(button("Mark as completed")).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    view.unmount();
    const other = renderCard({ startsIn: HOUR, status: "applied", variant: "received" });
    await advance(0);
    expect(vi.getTimerCount()).toBe(1);
    other.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends the button's status change for this booking", async () => {
    vi.useRealTimers();
    const view = renderCard({ startsIn: HOUR, status: "applied", variant: "received" });

    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    await vi.waitFor(() => expect(view.callsTo("booking.updateStatus")).toEqual([{ bookingId: "bk-1", status: "accepted" }]));
  });
});

describe("BookingCard details", () => {
  it("shows the listed pay and the start in the event's zone, labelled", () => {
    renderCard({ payCents: 45_000, startsIn: HOUR, status: "applied", timeZone: "America/Chicago", variant: "sent" });

    expect(screen.getByTestId("booking-pay").textContent).toBe("Listed pay: $450 total");
    // 13:00 UTC is 8:00 AM in Chicago (CDT) on June 1.
    expect(screen.getByText("Sat, Jun 1 · 8:00 AM CDT")).toBeTruthy();
  });

  it("leaves pay out when the event listed none, and labels a zone-less time as the reader's", () => {
    renderCard({ startsIn: HOUR, status: "applied", variant: "sent" });

    expect(screen.queryByTestId("booking-pay")).toBeNull();
    expect(screen.getByText("Sat, Jun 1 · 1:00 PM UTC (your time)")).toBeTruthy();
  });
});
