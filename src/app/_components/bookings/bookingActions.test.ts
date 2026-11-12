import { describe, expect, it } from "vitest";

import { BOOKING_STATUSES, checkTransition } from "~/server/_db/bookingTransitions";

import { bookingCardActions } from "./bookingActions";

const HOUR_MS = 60 * 60 * 1000;
const now = new Date("2026-06-01T12:00:00Z");
const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * HOUR_MS);

/** A four-hour event relative to `now`. */
const events = {
  endedAnHourAgo: { date: hoursFromNow(-5), duration: 4 },
  endsNow: { date: hoursFromNow(-4), duration: 4 },
  inProgress: { date: hoursFromNow(-1), duration: 4 },
  startsNow: { date: now, duration: 4 },
  upcoming: { date: hoursFromNow(24), duration: 4 },
};

const none = { accept: false, cancel: false, complete: false, decline: false };

describe("bookingCardActions", () => {
  describe("the applicant's card", () => {
    const actions = (status: string, event: { date: Date; duration: number }) =>
      bookingCardActions({ event, now, status, variant: "sent" });

    it("offers to cancel an application whenever the event is", () => {
      for (const event of Object.values(events)) {
        expect(actions("applied", event)).toEqual({ ...none, cancel: true });
      }
    });

    it("offers to cancel an accepted booking only before the event starts", () => {
      expect(actions("accepted", events.upcoming)).toEqual({ ...none, cancel: true });
      expect(actions("accepted", events.startsNow).cancel).toBe(false);
      expect(actions("accepted", events.inProgress).cancel).toBe(false);
      expect(actions("accepted", events.endedAnHourAgo).cancel).toBe(false);
    });

    it("offers to complete an accepted booking only once the event has ended", () => {
      expect(actions("accepted", events.upcoming).complete).toBe(false);
      expect(actions("accepted", events.endsNow)).toEqual({ ...none, complete: true });
      expect(actions("accepted", events.endedAnHourAgo)).toEqual({ ...none, complete: true });
    });

    it("offers nothing while an accepted booking's event is under way", () => {
      expect(actions("accepted", events.startsNow)).toEqual(none);
      expect(actions("accepted", events.inProgress)).toEqual(none);
    });

    it("counts the event's duration, not just its start", () => {
      const tenHours = { date: hoursFromNow(-9), duration: 10 };
      expect(actions("accepted", tenHours).complete).toBe(false);
      expect(actions("accepted", { ...tenHours, duration: 9 }).complete).toBe(true);
    });
  });

  describe("the event owner's card", () => {
    const actions = (status: string, event: { date: Date; duration: number }) =>
      bookingCardActions({ event, now, status, variant: "received" });

    it("offers to accept an application only before the event starts, and to decline it at any time", () => {
      expect(actions("applied", events.upcoming)).toEqual({ ...none, accept: true, decline: true });
      expect(actions("applied", events.inProgress)).toEqual({ ...none, decline: true });
      expect(actions("applied", events.endedAnHourAgo)).toEqual({ ...none, decline: true });
    });

    it("offers to complete an accepted booking once the event has ended, and never to cancel", () => {
      expect(actions("accepted", events.upcoming)).toEqual(none);
      expect(actions("accepted", events.inProgress)).toEqual(none);
      expect(actions("accepted", events.endedAnHourAgo)).toEqual({ ...none, complete: true });
    });
  });

  it("offers nothing on a booking in a final state", () => {
    for (const status of ["declined", "canceled", "completed"]) {
      for (const variant of ["sent", "received"] as const) {
        for (const event of Object.values(events)) {
          expect(bookingCardActions({ event, now, status, variant })).toEqual(none);
        }
      }
    }
  });

  it("never offers a button the server would refuse", () => {
    for (const status of BOOKING_STATUSES) {
      for (const event of Object.values(events)) {
        const applicant = bookingCardActions({ event, now, status, variant: "sent" });
        const owner = bookingCardActions({ event, now, status, variant: "received" });
        const accepts = (action: Parameters<typeof checkTransition>[0], role: "applicant" | "owner") =>
          checkTransition(action, role, { status }, event, now) === null;

        expect(applicant.accept).toBe(false);
        expect(applicant.decline).toBe(false);
        // "Cancel Application" sends status "canceled": a withdrawal or a cancellation.
        expect(applicant.cancel).toBe(accepts("withdraw", "applicant") || accepts("cancel", "applicant"));
        expect(applicant.complete).toBe(accepts("complete", "applicant"));
        expect(owner.accept).toBe(accepts("accept", "owner"));
        expect(owner.decline).toBe(accepts("decline", "owner"));
        expect(owner.cancel).toBe(false);
        expect(owner.complete).toBe(accepts("complete", "owner"));
      }
    }
  });
});
