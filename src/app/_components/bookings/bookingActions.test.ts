import { describe, expect, it } from "vitest";

import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  type BookingAction,
  type BookingRole,
  actionFor,
  checkTransition,
} from "~/server/_db/bookingTransitions";

import {
  ACTION_ORDER,
  availableBookingActions,
  bookingCardActions,
  requestedStatusFor,
  roleFor,
} from "./bookingActions";

const HOUR_MS = 60 * 60 * 1000;
const now = new Date("2026-06-01T12:00:00Z");
const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * HOUR_MS);

/** A four-hour event at every point relative to `now` that a rule turns on. */
const events = {
  endedAnHourAgo: { date: hoursFromNow(-5), duration: 4 },
  endsNow: { date: hoursFromNow(-4), duration: 4 },
  inProgress: { date: hoursFromNow(-1), duration: 4 },
  startsNow: { date: now, duration: 4 },
  upcoming: { date: hoursFromNow(24), duration: 4 },
};

const VARIANTS = ["sent", "received"] as const;
const ALL_ACTIONS = Object.keys(BOOKING_TRANSITIONS) as BookingAction[];
const none = { accept: false, cancel: false, complete: false, decline: false };

describe("availableBookingActions", () => {
  it("lists every action of the server's transition table exactly once", () => {
    expect([...ACTION_ORDER].sort()).toEqual([...ALL_ACTIONS].sort());
  });

  // The whole matrix: every role × every status × every point in time, each
  // compared with what the server's own check says for every action.
  for (const variant of VARIANTS) {
    const role: BookingRole = roleFor(variant);
    for (const status of BOOKING_STATUSES) {
      it(`offers the ${role} exactly what the server accepts on a "${status}" booking, at every point in time`, () => {
        for (const [when, event] of Object.entries(events)) {
          const accepted = ALL_ACTIONS.filter((action) => checkTransition(action, role, { status }, event, now) === null);
          expect([...availableBookingActions({ event, now, status, variant })].sort(), `${role} / ${status} / ${when}`).toEqual(
            [...accepted].sort(),
          );
        }
      });
    }
  }

  it("sends, for each offered action, a status the server reads as that same action", () => {
    for (const variant of VARIANTS) {
      for (const status of BOOKING_STATUSES) {
        for (const event of Object.values(events)) {
          for (const action of availableBookingActions({ event, now, status, variant })) {
            expect(actionFor(requestedStatusFor(action), status), `${variant} / ${status} / ${action}`).toBe(action);
          }
        }
      }
    }
  });

  it("offers nothing on an unknown status", () => {
    for (const variant of VARIANTS) {
      expect(availableBookingActions({ event: events.upcoming, now, status: "pending", variant })).toEqual([]);
    }
  });

  it("lets the event owner cancel an accepted booking before the event starts", () => {
    expect(availableBookingActions({ event: events.upcoming, now, status: "accepted", variant: "received" })).toEqual(["cancel"]);
    expect(availableBookingActions({ event: events.startsNow, now, status: "accepted", variant: "received" })).toEqual([]);
  });

  it("counts the event's duration, not just its start, before offering completion", () => {
    const tenHours = { date: hoursFromNow(-9), duration: 10 };
    expect(availableBookingActions({ event: tenHours, now, status: "accepted", variant: "sent" })).toEqual([]);
    expect(availableBookingActions({ event: { ...tenHours, duration: 9 }, now, status: "accepted", variant: "sent" })).toEqual([
      "complete",
    ]);
  });
});

describe("requestedStatusFor", () => {
  it("sends each action's transition target", () => {
    for (const action of ALL_ACTIONS) expect(requestedStatusFor(action)).toBe(BOOKING_TRANSITIONS[action].to);
  });
});

describe("bookingCardActions", () => {
  it("is availableBookingActions as one flag per kind of button", () => {
    for (const variant of VARIANTS) {
      for (const status of BOOKING_STATUSES) {
        for (const event of Object.values(events)) {
          const list = availableBookingActions({ event, now, status, variant });
          expect(bookingCardActions({ event, now, status, variant })).toEqual({
            accept: list.includes("accept"),
            cancel: list.includes("withdraw") || list.includes("cancel"),
            complete: list.includes("complete"),
            decline: list.includes("decline"),
          });
        }
      }
    }
  });

  it("gives the owner accept and decline on a new application, and cancel on an accepted booking before the event", () => {
    const owner = (status: string, event: { date: Date; duration: number }) =>
      bookingCardActions({ event, now, status, variant: "received" });
    expect(owner("applied", events.upcoming)).toEqual({ ...none, accept: true, decline: true });
    expect(owner("applied", events.inProgress)).toEqual({ ...none, decline: true });
    expect(owner("accepted", events.upcoming)).toEqual({ ...none, cancel: true });
    expect(owner("accepted", events.inProgress)).toEqual(none);
    expect(owner("accepted", events.endedAnHourAgo)).toEqual({ ...none, complete: true });
  });

  it("gives the applicant withdraw at any time, cancel before the event and complete after it", () => {
    const applicant = (status: string, event: { date: Date; duration: number }) =>
      bookingCardActions({ event, now, status, variant: "sent" });
    for (const event of Object.values(events)) expect(applicant("applied", event)).toEqual({ ...none, cancel: true });
    expect(applicant("accepted", events.upcoming)).toEqual({ ...none, cancel: true });
    expect(applicant("accepted", events.inProgress)).toEqual(none);
    expect(applicant("accepted", events.endsNow)).toEqual({ ...none, complete: true });
  });

  it("offers nothing on a booking in a final state", () => {
    for (const status of ["declined", "canceled", "completed"]) {
      for (const variant of VARIANTS) {
        for (const event of Object.values(events)) expect(bookingCardActions({ event, now, status, variant })).toEqual(none);
      }
    }
  });
});
