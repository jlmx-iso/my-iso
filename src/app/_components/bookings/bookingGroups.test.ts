import { describe, expect, it } from "vitest";

import { BOOKING_STATUSES } from "~/server/_db/bookingTransitions";

import { availableBookingActions } from "./bookingActions";
import { BOOKING_GROUPS, bookingGroupOf, bookingGroupSnapshot, groupBookings, needsReplyLabel } from "./bookingGroups";

const HOUR_MS = 60 * 60 * 1000;
const now = new Date("2026-06-01T12:00:00Z");
const at = (hours: number, duration = 4) => ({ date: new Date(now.getTime() + hours * HOUR_MS), duration });
const booking = (id: string, status: string, event = at(24)) => ({ event, id, status });

describe("bookingGroupOf", () => {
  it("puts an application in the owner's 'needs you', and in the applicant's 'upcoming'", () => {
    expect(bookingGroupOf(booking("a", "applied"), "received", now)).toBe("needsReply");
    expect(bookingGroupOf(booking("a", "applied"), "sent", now)).toBe("upcoming");
  });

  it("asks either side to mark an accepted booking completed once the event is over", () => {
    for (const variant of ["sent", "received"] as const) {
      expect(bookingGroupOf(booking("a", "accepted", at(-5)), variant, now)).toBe("needsReply");
      expect(bookingGroupOf(booking("a", "accepted", at(24)), variant, now)).toBe("upcoming");
      // Under way: nothing to do yet, and not over.
      expect(bookingGroupOf(booking("a", "accepted", at(-1)), variant, now)).toBe("upcoming");
    }
  });

  it("files finished and ended bookings as past, refused and withdrawn ones as closed", () => {
    expect(bookingGroupOf(booking("a", "completed", at(-48)), "sent", now)).toBe("past");
    // An application nobody answered before the event: over, only a withdrawal left.
    expect(bookingGroupOf(booking("a", "applied", at(-48)), "sent", now)).toBe("past");
    expect(bookingGroupOf(booking("a", "declined"), "sent", now)).toBe("closed");
    expect(bookingGroupOf(booking("a", "canceled"), "received", now)).toBe("closed");
  });

  it("says 'needs you' exactly when the card offers a reply, for every role, status and time", () => {
    for (const variant of ["sent", "received"] as const) {
      for (const status of BOOKING_STATUSES) {
        for (const hours of [48, 0, -1, -4, -48]) {
          const event = at(hours);
          const replies = availableBookingActions({ event, now, status, variant }).filter((action) =>
            ["accept", "decline", "complete"].includes(action),
          );
          expect(bookingGroupOf(booking("x", status, event), variant, now) === "needsReply", `${variant}/${status}/${hours}h`).toBe(
            replies.length > 0,
          );
        }
      }
    }
  });
});

describe("groupBookings", () => {
  it("sorts each group: soonest first while open, most recent first once done", () => {
    const groups = groupBookings(
      [
        booking("later", "applied", at(72)),
        booking("sooner", "applied", at(24)),
        booking("old", "completed", at(-200)),
        booking("recent", "completed", at(-20)),
        booking("no", "declined", at(10)),
      ],
      "received",
      now,
    );
    expect(groups.needsReply.map((b) => b.id)).toEqual(["sooner", "later"]);
    expect(groups.past.map((b) => b.id)).toEqual(["recent", "old"]);
    expect(groups.closed.map((b) => b.id)).toEqual(["no"]);
    expect(groups.upcoming).toEqual([]);
  });

  it("keeps every booking exactly once", () => {
    const all = BOOKING_STATUSES.flatMap((status, i) => [booking(`${status}-a`, status, at(24 + i)), booking(`${status}-b`, status, at(-24 - i))]);
    const groups = groupBookings(all, "received", now);
    const ids = BOOKING_GROUPS.flatMap((group) => groups[group].map((b) => b.id));
    expect(ids.sort()).toEqual(all.map((b) => b.id).sort());
  });
});

describe("needsReplyLabel", () => {
  it("shows the count, with a plus while more can be loaded, and nothing at zero", () => {
    expect(needsReplyLabel(3, false)).toBe("3");
    expect(needsReplyLabel(3, true)).toBe("3+");
    expect(needsReplyLabel(0, false)).toBeNull();
    expect(needsReplyLabel(0, true)).toBeNull();
  });
});

describe("pinned groups (a card with an open dialog stays put)", () => {
  it("keeps a booking in its group while pinned, even once the clock moves it", () => {
    // Accepted, the event starts in 30 minutes and lasts an hour: Upcoming now, "needs you" (complete) later.
    const card = booking("vineyard", "accepted", at(0.5, 1));
    const pinned = bookingGroupSnapshot([card], "sent", now);
    expect(pinned.get("vineyard")).toBe("upcoming");
    const later = new Date(now.getTime() + 2 * HOUR_MS);
    expect(groupBookings([card], "sent", later).needsReply.map((b) => b.id)).toEqual(["vineyard"]);
    expect(groupBookings([card], "sent", later, pinned).upcoming.map((b) => b.id)).toEqual(["vineyard"]);
  });

  it("keeps a booking whose status changed under the dialog in place too", () => {
    const pinned = bookingGroupSnapshot([booking("a", "accepted")], "received", now);
    expect(groupBookings([booking("a", "canceled")], "received", now, pinned).upcoming.map((b) => b.id)).toEqual(["a"]);
  });

  it("groups bookings it does not know as usual, and everything as usual once unpinned", () => {
    const pinned = bookingGroupSnapshot([booking("a", "applied")], "received", now);
    const groups = groupBookings([booking("a", "applied"), booking("new", "declined")], "received", now, pinned);
    expect(groups.needsReply.map((b) => b.id)).toEqual(["a"]);
    expect(groups.closed.map((b) => b.id)).toEqual(["new"]);
    expect(groupBookings([booking("a", "canceled")], "received", now, null).closed.map((b) => b.id)).toEqual(["a"]);
  });
});
