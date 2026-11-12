import { describe, expect, it } from "vitest";

import {
  BOOKING_STATUSES,
  applicationOfBooking,
  applicationsByEvent,
  applyBlockerOf,
  bookingHint,
  bookingStatusView,
  formatRate,
} from "./bookings";

const now = new Date("2026-06-15T12:00:00Z");
const tomorrow = new Date("2026-06-16T12:00:00Z");
const yesterday = new Date("2026-06-14T12:00:00Z");

const at = (date: Date, duration = 0) => ({ date, duration });

describe("bookingHint", () => {
  it("explains why an accepted booking cannot be completed yet", () => {
    expect(bookingHint({ event: at(tomorrow, 4), now, role: "owner", status: "accepted" })).toMatch(/once the event is over/);
    expect(bookingHint({ event: at(new Date(now.getTime() - 1000), 4), now, role: "owner", status: "accepted" })).toMatch(
      /under way/,
    );
    expect(bookingHint({ event: at(yesterday, 4), now, role: "owner", status: "accepted" })).toBeNull();
  });

  it("tells an applicant who withdrew that they can apply again, while the event is ahead", () => {
    const withdrawn = { canReapply: true, role: "applicant", status: "canceled" } as const;
    expect(bookingHint({ ...withdrawn, event: at(tomorrow), now })).toMatch(/apply again/);
    expect(bookingHint({ ...withdrawn, event: at(yesterday), now })).toBeNull();
    expect(bookingHint({ ...withdrawn, canReapply: false, event: at(tomorrow), now })).toBeNull();
    expect(bookingHint({ ...withdrawn, event: at(tomorrow), now, role: "owner" })).toBeNull();
  });

  it("has nothing to add to a fresh application", () => {
    expect(bookingHint({ event: at(tomorrow), now, role: "owner", status: "applied" })).toBeNull();
  });
});

describe("bookingStatusView", () => {
  it("labels every status in sentence case", () => {
    for (const status of BOOKING_STATUSES) {
      const { label } = bookingStatusView(status);
      expect(label).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
    }
  });

  it("never draws Completed like Declined", () => {
    const completed = bookingStatusView("completed");
    const declined = bookingStatusView("declined");
    expect(completed.color).not.toBe(declined.color);
    expect(completed.variant).not.toBe(declined.variant);
  });

  it("shows an unknown status readably instead of hiding it", () => {
    expect(bookingStatusView("on_hold")).toEqual({ color: "gray", label: "On hold", variant: "outline" });
  });
});

describe("formatRate", () => {
  it("writes a bare number as dollars", () => {
    expect(formatRate("400.0")).toBe("$400");
    expect(formatRate("62.5")).toBe("$62.50");
    expect(formatRate(" 1200 ")).toBe("$1,200");
  });

  it("keeps what a person wrote", () => {
    expect(formatRate("$50/hr")).toBe("$50/hr");
    expect(formatRate("negotiable")).toBe("negotiable");
  });

  it("has nothing to show for an empty rate", () => {
    expect(formatRate(null)).toBeNull();
    expect(formatRate("  ")).toBeNull();
  });
});

describe("applicationOfBooking", () => {
  it("lets only an application the applicant withdrew be sent again", () => {
    expect(applicationOfBooking({ cancelOrigin: "withdrawn", status: "canceled" })).toEqual({ canReapply: true, hasApplied: true, status: "canceled" });
    expect(applicationOfBooking({ cancelOrigin: "canceled_by_owner", status: "canceled" }).canReapply).toBe(false);
    // A legacy canceled booking with no recorded origin cannot be reopened.
    expect(applicationOfBooking({ cancelOrigin: null, status: "canceled" }).canReapply).toBe(false);
    expect(applicationOfBooking({ status: "canceled" }).canReapply).toBe(false);
    expect(applicationOfBooking({ cancelOrigin: "withdrawn", status: "applied" }).canReapply).toBe(false);
  });
});

describe("applicationsByEvent", () => {
  it("maps each event to the viewer's application", () => {
    const byEvent = applicationsByEvent([
      { eventId: "a", status: "applied" },
      { cancelOrigin: "withdrawn", eventId: "b", status: "canceled" },
    ]);
    expect(byEvent.get("a")).toEqual({ canReapply: false, hasApplied: true, status: "applied" });
    expect(byEvent.get("b")?.canReapply).toBe(true);
    expect(byEvent.get("c")).toBeUndefined();
  });
});

describe("applyBlockerOf", () => {
  it("reads what a feed row shows: started, filled, or open", () => {
    expect(applyBlockerOf({ date: yesterday }, now)).toBe("event_started");
    expect(applyBlockerOf({ date: now.toISOString() }, now)).toBe("event_started");
    expect(applyBlockerOf({ date: tomorrow, isFulfilled: true }, now)).toBe("event_filled");
    expect(applyBlockerOf({ date: tomorrow, isFulfilled: false }, now)).toBeNull();
  });
});
