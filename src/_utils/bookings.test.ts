import { describe, expect, it } from "vitest";

import {
  BOOKING_STATUSES as SERVER_STATUSES,
  BOOKING_TRANSITIONS,
  actionFor,
  checkTransition,
} from "~/server/_db/bookingTransitions";

import {
  ACTION_TARGET_STATUS,
  BOOKING_STATUSES,
  DESTRUCTIVE_ACTIONS,
  type BookingAction,
  type BookingRole,
  applicationOf,
  applicationOfBooking,
  applicationsByEvent,
  availableBookingActions,
  bookingHint,
  bookingStatusView,
  canApply,
  eventPhase,
  formatRate,
} from "./bookings";

const now = new Date("2026-06-15T12:00:00Z");
const tomorrow = new Date("2026-06-16T12:00:00Z");
const yesterday = new Date("2026-06-14T12:00:00Z");
const ACTIONS = Object.keys(BOOKING_TRANSITIONS) as BookingAction[];
const ROLES: BookingRole[] = ["applicant", "owner"];

const at = (date: Date, duration = 0) => ({ date, duration });

describe("availableBookingActions", () => {
  it("offers exactly what the server's state machine accepts, for every role, status and time", () => {
    expect([...BOOKING_STATUSES].sort()).toEqual([...SERVER_STATUSES].sort());
    for (const role of ROLES) {
      for (const status of SERVER_STATUSES) {
        for (const eventDate of [tomorrow, yesterday, now]) {
          const accepted = ACTIONS.filter((action) => {
            // A "canceled" request means withdraw or cancel depending on the status.
            const meant = actionFor(BOOKING_TRANSITIONS[action].to as "accepted", status);
            return meant === action && checkTransition(action, role, { status }, eventDate, now) === null;
          }).sort();
          const offered = availableBookingActions({ event: at(eventDate), now, role, status }).sort();
          expect(offered, `${role} / ${status} / ${eventDate.toISOString()}`).toEqual(accepted);
        }
      }
    }
  });

  it("asks the server for the status each action leads to", () => {
    for (const action of ACTIONS) {
      expect(ACTION_TARGET_STATUS[action]).toBe(BOOKING_TRANSITIONS[action].to);
    }
  });

  it("gives the owner accept then decline on a new application, and the applicant withdraw", () => {
    expect(availableBookingActions({ event: at(tomorrow), now, role: "owner", status: "applied" })).toEqual([
      "accept",
      "decline",
    ]);
    expect(availableBookingActions({ event: at(tomorrow), now, role: "applicant", status: "applied" })).toEqual([
      "withdraw",
    ]);
  });

  it("only lets the owner decline an application once the event has started", () => {
    expect(availableBookingActions({ event: at(yesterday, 4), now, role: "owner", status: "applied" })).toEqual([
      "decline",
    ]);
  });

  it("lets either side cancel an accepted booking only before the event starts", () => {
    for (const role of ROLES) {
      expect(availableBookingActions({ event: at(tomorrow, 8), now, role, status: "accepted" })).toEqual(["cancel"]);
    }
  });

  it("lets either side complete an accepted booking only once the event has ended", () => {
    const startedAnHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    for (const role of ROLES) {
      // A ten-hour job that began an hour ago is neither cancellable nor done.
      expect(availableBookingActions({ event: at(startedAnHourAgo, 10), now, role, status: "accepted" })).toEqual([]);
      expect(availableBookingActions({ event: at(startedAnHourAgo, 1), now, role, status: "accepted" })).toEqual([
        "complete",
      ]);
      expect(availableBookingActions({ event: at(yesterday, 8), now, role, status: "accepted" })).toEqual(["complete"]);
    }
  });

  it("treats an unknown duration as none", () => {
    expect(
      availableBookingActions({ event: { date: yesterday.toISOString() }, now, role: "owner", status: "accepted" }),
    ).toEqual(["complete"]);
    expect(eventPhase({ date: yesterday, duration: null }, now)).toBe("after");
  });

  it("offers nothing on a finished booking or an unknown status", () => {
    for (const status of ["declined", "completed", "canceled", "pending", ""]) {
      for (const role of ROLES) {
        expect(availableBookingActions({ event: at(tomorrow), now, role, status })).toEqual([]);
      }
    }
  });

  it("treats decline, cancel and withdraw as destructive", () => {
    expect([...DESTRUCTIVE_ACTIONS].sort()).toEqual(["cancel", "decline", "withdraw"]);
  });
});

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

describe("applicationOf", () => {
  it("reads a boolean", () => {
    expect(applicationOf(true)).toEqual({ canReapply: false, status: "applied" });
    expect(applicationOf(false)).toEqual({ canReapply: false, status: "none" });
  });

  it("reads { hasApplied } with or without a status", () => {
    expect(applicationOf({ hasApplied: false, status: null }).status).toBe("none");
    expect(applicationOf({ hasApplied: true }).status).toBe("applied");
    expect(applicationOf({ hasApplied: true, status: "accepted" })).toEqual({ canReapply: false, status: "accepted" });
  });

  it("believes the server about applying again", () => {
    expect(applicationOf({ canReapply: true, hasApplied: true, status: "canceled" }).canReapply).toBe(true);
    // Canceled by the owner, or after it had been accepted.
    expect(applicationOf({ canReapply: false, hasApplied: true, status: "canceled" }).canReapply).toBe(false);
    // Never for an application that still stands, whatever is claimed.
    expect(applicationOf({ canReapply: true, hasApplied: true, status: "applied" }).canReapply).toBe(false);
  });

  it("assumes a canceled application can be sent again when the server does not say", () => {
    expect(applicationOf({ hasApplied: true, status: "canceled" }).canReapply).toBe(true);
  });

  it("treats an application with a status it does not know as applied", () => {
    expect(applicationOf({ hasApplied: true, status: "pending" }).status).toBe("applied");
    expect(applicationOf({ status: "pending" }).status).toBe("applied");
  });

  it("treats anything else as no application", () => {
    for (const value of [undefined, null, "applied", 1]) {
      expect(applicationOf(value)).toEqual({ canReapply: false, status: "none" });
    }
  });
});

describe("applicationOfBooking", () => {
  it("uses cancelOrigin when the booking carries one", () => {
    expect(applicationOfBooking({ cancelOrigin: "withdrawn", status: "canceled" }).canReapply).toBe(true);
    expect(applicationOfBooking({ cancelOrigin: "canceled_by_owner", status: "canceled" }).canReapply).toBe(false);
    // A legacy canceled booking with no recorded origin cannot be reopened.
    expect(applicationOfBooking({ cancelOrigin: null, status: "canceled" }).canReapply).toBe(false);
  });

  it("falls back to the status alone without one", () => {
    expect(applicationOfBooking({ status: "canceled" }).canReapply).toBe(true);
    expect(applicationOfBooking({ status: "declined" })).toEqual({ canReapply: false, status: "declined" });
  });
});

describe("canApply", () => {
  const none = { canReapply: false, status: "none" } as const;

  it("allows a first application and one after a withdrawal", () => {
    expect(canApply({ application: none, eventDate: tomorrow, now })).toBe(true);
    expect(canApply({ application: { canReapply: true, status: "canceled" }, eventDate: tomorrow, now })).toBe(true);
  });

  it("refuses while an application stands, was declined, is done, or was canceled for good", () => {
    for (const status of ["applied", "accepted", "declined", "completed", "canceled"] as const) {
      expect(canApply({ application: { canReapply: false, status }, eventDate: tomorrow, now })).toBe(false);
    }
  });

  it("refuses for a past or filled event", () => {
    expect(canApply({ application: none, eventDate: yesterday, now })).toBe(false);
    expect(canApply({ application: none, eventDate: tomorrow, isFilled: true, now })).toBe(false);
  });
});

describe("applicationsByEvent", () => {
  it("maps each event to the viewer's application", () => {
    const byEvent = applicationsByEvent([
      { eventId: "a", status: "applied" },
      { cancelOrigin: "withdrawn", eventId: "b", status: "canceled" },
    ]);
    expect(byEvent.get("a")).toEqual({ canReapply: false, status: "applied" });
    expect(byEvent.get("b")).toEqual({ canReapply: true, status: "canceled" });
    expect(byEvent.get("c")).toBeUndefined();
  });
});
