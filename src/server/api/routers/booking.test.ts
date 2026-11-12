import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorReason } from "~/_utils/errorReason";
import {
  actionFor,
  applyTransition,
  BOOKING_TRANSITIONS,
  checkTransition,
  type BookingAction,
  type BookingRole,
  withDerivedFulfilled,
} from "~/server/_db/bookingTransitions";
import { reasonOf } from "~/server/api/reasonedError";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/server/_lib/posthog", () => ({ captureEvent: vi.fn() }));

import { bookingRouter } from "./booking";

type TestUser = { email: string; id: string };

const DAY_MS = 24 * 60 * 60 * 1000;

freezeRateLimitClock();

describe("booking state machine", () => {
  let testDb: TestDb;
  let owner: TestUser;
  let applicant: TestUser;
  let rival: TestUser;
  let stranger: TestUser;

  const as = (user: TestUser) => createDbCaller(bookingRouter, testDb.db, { user });

  const errorOf = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error("expected a rejection");
      },
      (error: unknown) => error,
    );

  async function createEvent(daysFromNow = 30) {
    const photographer = await testDb.db.photographer.upsert({
      create: { companyName: "Co", location: "Austin", name: "Owner", userId: owner.id },
      update: {},
      where: { userId: owner.id },
    });
    return testDb.db.event.create({
      data: {
        date: new Date(Date.now() + daysFromNow * DAY_MS),
        location: "Austin",
        photographerId: photographer.id,
        title: "Lakeside wedding",
      },
    });
  }

  /** Moves the event into the past, as if time had gone by. */
  const eventHasHappened = (eventId: string) =>
    testDb.db.event.update({ data: { date: new Date(Date.now() - DAY_MS) }, where: { id: eventId } });

  const statusOf = async (bookingId: string) =>
    (await testDb.raw.booking.findUniqueOrThrow({ where: { id: bookingId } })).status;

  /** Whether the event is filled, as every read of an event reports it: derived from the bookings. */
  const isFulfilled = async (eventId: string) =>
    (await withDerivedFulfilled(testDb.db, [{ id: eventId }]))[0]?.isFulfilled;

  const notificationsFor = (user: TestUser) =>
    testDb.db.notification.findMany({ orderBy: { createdAt: "asc" }, where: { recipientId: user.id } });

  /** An application by `who` (default: the applicant) to a new event. */
  async function applied(who: TestUser = applicant) {
    const event = await createEvent();
    const booking = await as(who).applyToEvent({ eventId: event.id, notes: "I'd love to help" });
    return { booking, event };
  }

  async function accepted() {
    const { booking, event } = await applied();
    await as(owner).updateStatus({ bookingId: booking.id, status: "accepted" });
    return { booking, event };
  }

  beforeEach(async () => {
    testDb = await createTestDb();
    owner = await createTestUser(testDb.db, { firstName: "Olivia", lastName: "Owner" });
    applicant = await createTestUser(testDb.db, { firstName: "Adam", lastName: "Applicant" });
    rival = await createTestUser(testDb.db);
    stranger = await createTestUser(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  describe("the transition table", () => {
    const actions = Object.keys(BOOKING_TRANSITIONS) as BookingAction[];
    const roles: BookingRole[] = ["applicant", "owner"];
    // A two-hour event tomorrow, one that began an hour ago, one from yesterday.
    const future = { date: new Date(Date.now() + DAY_MS), duration: 2 };
    const ongoing = { date: new Date(Date.now() - DAY_MS / 24), duration: 2 };
    const past = { date: new Date(Date.now() - DAY_MS), duration: 2 };
    const allowed = new Set([
      "withdraw:applicant:applied:ongoing",
      "decline:owner:applied:ongoing",
      "withdraw:applicant:applied:future",
      "withdraw:applicant:applied:past",
      "accept:owner:applied:future",
      "decline:owner:applied:future",
      "decline:owner:applied:past",
      "cancel:applicant:accepted:future",
      "cancel:owner:accepted:future",
      "complete:applicant:accepted:past",
      "complete:owner:accepted:past",
    ]);

    it("allows exactly the documented (action, role, state, timing) combinations", () => {
      const found = new Set<string>();
      for (const action of actions) {
        for (const role of roles) {
          for (const status of ["applied", "accepted", "declined", "completed", "canceled"]) {
            for (const [label, event] of [["future", future], ["ongoing", ongoing], ["past", past]] as const) {
              if (checkTransition(action, role, { status }, event, new Date()) === null) {
                found.add(`${action}:${role}:${status}:${label}`);
              }
            }
          }
        }
      }
      expect([...found].sort()).toEqual([...allowed].sort());
    });

    it("reads 'canceled' as a withdrawal or a cancellation depending on the state", () => {
      expect(actionFor("canceled", "applied")).toBe("withdraw");
      expect(actionFor("canceled", "accepted")).toBe("cancel");
      expect(actionFor("accepted", "applied")).toBe("accept");
      expect(actionFor("declined", "applied")).toBe("decline");
      expect(actionFor("completed", "accepted")).toBe("complete");
    });
  });

  describe("apply", () => {
    it("creates an application and notifies the owner", async () => {
      const { booking } = await applied();

      expect(booking).toMatchObject({ applicantId: applicant.id, ownerId: owner.id, status: "applied" });
      expect(await notificationsFor(owner)).toMatchObject([
        { body: 'Adam Applicant applied to "Lakeside wedding".', linkUrl: "/app/bookings", type: "booking_applied" },
      ]);
    });

    it("refuses an event that already has its second shooter", async () => {
      const { event } = await accepted();

      const error = await errorOf(as(rival).applyToEvent({ eventId: event.id }));

      expect(error).toMatchObject({ code: "CONFLICT" });
      expect(reasonOf(error)).toBe(ErrorReason.BOOKING_EVENT_FILLED);
    });

    it("refuses an event that has started", async () => {
      const event = await createEvent();
      await eventHasHappened(event.id);

      expect(reasonOf(await errorOf(as(applicant).applyToEvent({ eventId: event.id })))).toBe(
        ErrorReason.BOOKING_EVENT_STARTED,
      );
    });

    it("lets someone who withdrew apply again, on the same booking", async () => {
      const { booking, event } = await applied();
      await as(applicant).updateStatus({ bookingId: booking.id, status: "canceled" });

      const again = await as(applicant).applyToEvent({ eventId: event.id, notes: "Changed my mind" });

      expect(again).toMatchObject({ id: booking.id, notes: "Changed my mind", status: "applied" });
    });

    it("a re-application is a new application: it is dated now and heads the owner's list", async () => {
      const { booking, event } = await applied();
      await as(applicant).updateStatus({ bookingId: booking.id, status: "canceled" });
      // That was months ago, and the owner has had other applications since.
      const longAgo = new Date(Date.now() - 90 * DAY_MS);
      await testDb.raw.booking.update({ data: { createdAt: longAgo }, where: { id: booking.id } });
      const other = await createEvent(40);
      const newer = await as(rival).applyToEvent({ eventId: other.id });
      expect((await as(owner).getReceivedApplications()).map((row) => row.id)).toEqual([newer.id, booking.id]);

      const before = Date.now();
      const again = await as(applicant).applyToEvent({ eventId: event.id });

      expect(again.id).toBe(booking.id);
      expect(again.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect((await as(owner).getReceivedApplications()).map((row) => row.id)).toEqual([booking.id, newer.id]);
      expect((await as(owner).getReceivedApplicationsPage({ limit: 1 })).items.map((row) => row.id)).toEqual([booking.id]);
      // The applicant's own list is ordered the same way.
      expect((await as(applicant).getMyApplications())[0]).toMatchObject({ id: booking.id });
    });

    it("re-applying keeps what the owner wrote and clears how the booking was cancelled", async () => {
      const { booking, event } = await applied();
      await as(applicant).updateStatus({ bookingId: booking.id, status: "canceled" });
      await testDb.raw.booking.update({ data: { ownerNotes: "Kept for my records" }, where: { id: booking.id } });
      expect(await testDb.raw.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ cancelOrigin: "withdrawn" });
      expect(await as(applicant).hasApplied({ eventId: event.id })).toEqual({ canReapply: true, hasApplied: true, status: "canceled" });

      await as(applicant).applyToEvent({ eventId: event.id, rate: "$400" });

      expect(await testDb.raw.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({
        cancelOrigin: null,
        ownerNotes: "Kept for my records",
        rate: "$400",
        status: "applied",
      });
      expect(await as(applicant).hasApplied({ eventId: event.id })).toEqual({ canReapply: false, hasApplied: true, status: "applied" });
    });

    it.each([
      ["the owner cancelled", "owner", "canceled_by_owner"],
      ["the applicant backed out of", "applicant", "canceled_by_applicant"],
    ] as const)("does not reopen an accepted booking that %s", async (_label, who, cancelOrigin) => {
      const { booking, event } = await accepted();
      await as(who === "owner" ? owner : applicant).updateStatus({ bookingId: booking.id, status: "canceled" });
      await testDb.raw.booking.update({ data: { ownerNotes: "Plans changed, sorry" }, where: { id: booking.id } });

      const error = await errorOf(as(applicant).applyToEvent({ eventId: event.id, notes: "Take me back" }));

      expect(error).toMatchObject({ code: "CONFLICT" });
      expect(await testDb.raw.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({
        cancelOrigin,
        notes: "I'd love to help",
        ownerNotes: "Plans changed, sorry",
        status: "canceled",
      });
      expect(await as(applicant).hasApplied({ eventId: event.id })).toEqual({ canReapply: false, hasApplied: true, status: "canceled" });
      // The owner was not told about an application that did not happen.
      expect((await notificationsFor(owner)).filter((n) => n.type === "booking_applied")).toHaveLength(1);
    });

    it("does not reopen a booking cancelled before the origin was recorded (unknown who cancelled)", async () => {
      const { booking, event } = await applied();
      await testDb.raw.booking.update({ data: { cancelOrigin: null, status: "canceled" }, where: { id: booking.id } });

      await expect(as(applicant).applyToEvent({ eventId: event.id })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await statusOf(booking.id)).toBe("canceled");
    });

    it("reports no application, and nothing to re-apply to, for an event never applied to", async () => {
      const event = await createEvent();

      expect(await as(applicant).hasApplied({ eventId: event.id })).toEqual({ canReapply: false, hasApplied: false, status: null });
    });

    it("does not let a declined applicant apply again", async () => {
      const { booking, event } = await applied();
      await as(owner).updateStatus({ bookingId: booking.id, status: "declined" });

      await expect(as(applicant).applyToEvent({ eventId: event.id })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await statusOf(booking.id)).toBe("declined");
    });
  });

  describe("accept and decline (owner)", () => {
    it("accepts an application, fills the event and notifies the applicant", async () => {
      const { booking, event } = await applied();

      const result = await as(owner).updateStatus({
        bookingId: booking.id,
        ownerNotes: "See you there",
        status: "accepted",
      });

      expect(result).toMatchObject({ ownerNotes: "See you there", status: "accepted" });
      expect(await isFulfilled(event.id)).toBe(true);
      expect(await notificationsFor(applicant)).toMatchObject([
        { body: 'Olivia Owner accepted your application for "Lakeside wedding".', type: "booking_accepted" },
      ]);
    });

    it("declines an application and notifies the applicant; the event stays open", async () => {
      const { booking, event } = await applied();

      await as(owner).updateStatus({ bookingId: booking.id, status: "declined" });

      expect(await statusOf(booking.id)).toBe("declined");
      expect(await isFulfilled(event.id)).toBe(false);
      expect(await notificationsFor(applicant)).toMatchObject([{ type: "booking_declined" }]);
    });

    it("does not let the applicant accept or decline their own application", async () => {
      const { booking } = await applied();

      for (const status of ["accepted", "declined"] as const) {
        const error = await errorOf(as(applicant).updateStatus({ bookingId: booking.id, status }));
        expect(error).toMatchObject({ code: "FORBIDDEN" });
        expect(reasonOf(error)).toBe(ErrorReason.BOOKING_NOT_ALLOWED);
      }
      expect(await statusOf(booking.id)).toBe("applied");
    });

    it("does not accept an application the applicant has withdrawn", async () => {
      const { booking, event } = await applied();
      await as(applicant).updateStatus({ bookingId: booking.id, status: "canceled" });

      const error = await errorOf(as(owner).updateStatus({ bookingId: booking.id, status: "accepted" }));

      expect(error).toMatchObject({ code: "CONFLICT" });
      expect(reasonOf(error)).toBe(ErrorReason.BOOKING_INVALID_TRANSITION);
      expect(await statusOf(booking.id)).toBe("canceled");
      expect(await isFulfilled(event.id)).toBe(false);
    });

    it("does not accept once the event has started", async () => {
      const { booking, event } = await applied();
      await eventHasHappened(event.id);

      expect(
        reasonOf(await errorOf(as(owner).updateStatus({ bookingId: booking.id, status: "accepted" }))),
      ).toBe(ErrorReason.BOOKING_EVENT_STARTED);
    });

    it("accepts only one applicant per event", async () => {
      const event = await createEvent();
      const first = await as(applicant).applyToEvent({ eventId: event.id });
      const second = await as(rival).applyToEvent({ eventId: event.id });
      await as(owner).updateStatus({ bookingId: first.id, status: "accepted" });

      const error = await errorOf(as(owner).updateStatus({ bookingId: second.id, status: "accepted" }));

      expect(reasonOf(error)).toBe(ErrorReason.BOOKING_EVENT_FILLED);
      expect(await statusOf(second.id)).toBe("applied");
    });
  });

  describe("withdraw and cancel", () => {
    it("lets the applicant withdraw an application and notifies the owner", async () => {
      const { booking } = await applied();

      await as(applicant).updateStatus({ bookingId: booking.id, status: "canceled" });

      expect(await statusOf(booking.id)).toBe("canceled");
      expect((await notificationsFor(owner)).map((n) => n.type)).toEqual(["booking_applied", "booking_canceled"]);
    });

    it("does not let the owner cancel a mere application (they decline it)", async () => {
      const { booking } = await applied();

      expect(
        reasonOf(await errorOf(as(owner).updateStatus({ bookingId: booking.id, status: "canceled" }))),
      ).toBe(ErrorReason.BOOKING_NOT_ALLOWED);
    });

    it.each(["applicant", "owner"] as const)(
      "lets the %s cancel an accepted booking before the event, reopening it",
      async (who) => {
        const { booking, event } = await accepted();
        const actor = who === "owner" ? owner : applicant;
        const other = who === "owner" ? applicant : owner;

        await as(actor).updateStatus({ bookingId: booking.id, status: "canceled" });

        expect(await statusOf(booking.id)).toBe("canceled");
        expect(await isFulfilled(event.id)).toBe(false);
        expect((await notificationsFor(other)).at(-1)).toMatchObject({ type: "booking_canceled" });
      },
    );

    it("does not cancel an accepted booking once the event has started", async () => {
      const { booking, event } = await accepted();
      await eventHasHappened(event.id);

      expect(
        reasonOf(await errorOf(as(applicant).updateStatus({ bookingId: booking.id, status: "canceled" }))),
      ).toBe(ErrorReason.BOOKING_EVENT_STARTED);
      expect(await isFulfilled(event.id)).toBe(true);
    });

    it("lets another applicant be accepted after a cancellation", async () => {
      const event = await createEvent();
      const first = await as(applicant).applyToEvent({ eventId: event.id });
      const second = await as(rival).applyToEvent({ eventId: event.id });
      await as(owner).updateStatus({ bookingId: first.id, status: "accepted" });
      await as(applicant).updateStatus({ bookingId: first.id, status: "canceled" });

      await as(owner).updateStatus({ bookingId: second.id, status: "accepted" });

      expect(await statusOf(second.id)).toBe("accepted");
      expect(await isFulfilled(event.id)).toBe(true);
    });
  });

  describe("complete", () => {
    it.each(["applicant", "owner"] as const)("lets the %s complete an accepted booking after the event", async (who) => {
      const { booking, event } = await accepted();
      await eventHasHappened(event.id);

      await as(who === "owner" ? owner : applicant).updateStatus({ bookingId: booking.id, status: "completed" });

      expect(await statusOf(booking.id)).toBe("completed");
      expect(await isFulfilled(event.id)).toBe(true);
      expect((await notificationsFor(who === "owner" ? applicant : owner)).at(-1)).toMatchObject({
        type: "booking_completed",
      });
    });

    it("does not complete while the event is still going on (it has started but not ended)", async () => {
      const { booking, event } = await accepted();
      // A ten-hour job that began an hour ago.
      await testDb.db.event.update({ data: { date: new Date(Date.now() - DAY_MS / 24), duration: 10 }, where: { id: event.id } });

      for (const actor of [owner, applicant]) {
        const error = await errorOf(as(actor).updateStatus({ bookingId: booking.id, status: "completed" }));
        expect(error).toMatchObject({ code: "BAD_REQUEST" });
        expect(reasonOf(error)).toBe(ErrorReason.BOOKING_NOT_YET_COMPLETABLE);
      }
      expect(await statusOf(booking.id)).toBe("accepted");
      // Nor can it be cancelled any more: that was possible until it started.
      expect(reasonOf(await errorOf(as(owner).updateStatus({ bookingId: booking.id, status: "canceled" })))).toBe(
        ErrorReason.BOOKING_EVENT_STARTED,
      );

      // Eleven hours after the start it has ended.
      await testDb.db.event.update({ data: { date: new Date(Date.now() - 11 * (DAY_MS / 24)) }, where: { id: event.id } });
      await as(applicant).updateStatus({ bookingId: booking.id, status: "completed" });
      expect(await statusOf(booking.id)).toBe("completed");
    });

    it("does not complete before the event has taken place", async () => {
      const { booking } = await accepted();

      const error = await errorOf(as(owner).updateStatus({ bookingId: booking.id, status: "completed" }));

      expect(error).toMatchObject({ code: "BAD_REQUEST" });
      expect(reasonOf(error)).toBe(ErrorReason.BOOKING_NOT_YET_COMPLETABLE);
    });

    it.each(["applied", "declined", "canceled", "completed"])(
      "does not complete a booking that is %s",
      async (status) => {
        const { booking, event } = await applied();
        await eventHasHappened(event.id);
        await testDb.raw.booking.update({ data: { status }, where: { id: booking.id } });

        for (const actor of [owner, applicant]) {
          expect(
            reasonOf(await errorOf(as(actor).updateStatus({ bookingId: booking.id, status: "completed" }))),
          ).toBe(ErrorReason.BOOKING_INVALID_TRANSITION);
        }
        expect(await statusOf(booking.id)).toBe(status);
      },
    );
  });

  describe("final states", () => {
    it.each(["declined", "completed", "canceled"])("nothing moves a %s booking", async (finalStatus) => {
      const { booking } = await applied();
      await testDb.raw.booking.update({ data: { status: finalStatus }, where: { id: booking.id } });

      for (const actor of [owner, applicant]) {
        for (const status of ["accepted", "declined", "completed", "canceled"] as const) {
          await expect(as(actor).updateStatus({ bookingId: booking.id, status })).rejects.toBeDefined();
        }
      }
      expect(await statusOf(booking.id)).toBe(finalStatus);
    });
  });

  describe("who may write what", () => {
    it("does not let the applicant write the owner's notes", async () => {
      const { booking } = await applied();

      const error = await errorOf(
        as(applicant).updateStatus({ bookingId: booking.id, ownerNotes: "Accepted, honest", status: "canceled" }),
      );

      expect(reasonOf(error)).toBe(ErrorReason.BOOKING_NOT_ALLOWED);
      expect(await testDb.raw.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({
        ownerNotes: null,
        status: "applied",
      });
    });

    it("hides bookings from people who are not part of them", async () => {
      const { booking } = await applied();

      for (const status of ["accepted", "declined", "completed", "canceled"] as const) {
        await expect(as(stranger).updateStatus({ bookingId: booking.id, status })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      }
      expect(await statusOf(booking.id)).toBe("applied");
    });

    it("treats a booking of a deleted event as gone", async () => {
      const { booking, event } = await applied();
      await testDb.raw.event.update({ data: { isDeleted: true }, where: { id: event.id } });

      await expect(as(owner).updateStatus({ bookingId: booking.id, status: "accepted" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("races", () => {
    it("two simultaneous accepts of one application: exactly one succeeds", async () => {
      const { booking, event } = await applied();

      const results = await Promise.allSettled([
        as(owner).updateStatus({ bookingId: booking.id, status: "accepted" }),
        as(owner).updateStatus({ bookingId: booking.id, status: "accepted" }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(reasonOf(rejected?.status === "rejected" ? rejected.reason : null)).toBe(
        ErrorReason.BOOKING_INVALID_TRANSITION,
      );
      expect(await statusOf(booking.id)).toBe("accepted");
      expect(await isFulfilled(event.id)).toBe(true);
      expect((await notificationsFor(applicant)).filter((n) => n.type === "booking_accepted")).toHaveLength(1);
    });

    it("simultaneous accepts of two applicants: one is accepted, the event is filled once", async () => {
      const event = await createEvent();
      const first = await as(applicant).applyToEvent({ eventId: event.id });
      const second = await as(rival).applyToEvent({ eventId: event.id });

      const results = await Promise.allSettled([
        as(owner).updateStatus({ bookingId: first.id, status: "accepted" }),
        as(owner).updateStatus({ bookingId: second.id, status: "accepted" }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const statuses = [await statusOf(first.id), await statusOf(second.id)].sort();
      expect(statuses).toEqual(["accepted", "applied"]);
      expect(await isFulfilled(event.id)).toBe(true);
    });

    it("accept against withdraw: one wins, and the event matches the outcome", async () => {
      for (let round = 0; round < 5; round++) {
        const { booking, event } = await applied();

        const [accept, withdraw] = await Promise.allSettled([
          as(owner).updateStatus({ bookingId: booking.id, status: "accepted" }),
          as(applicant).updateStatus({ bookingId: booking.id, status: "canceled" }),
        ]);

        const status = await statusOf(booking.id);
        // The loser is refused; a withdrawal that arrives after the accept
        // may legitimately go through as a cancellation of the booking.
        expect(["accepted", "canceled"]).toContain(status);
        expect(accept.status === "fulfilled" || withdraw.status === "fulfilled").toBe(true);
        expect(await isFulfilled(event.id)).toBe(status === "accepted");
      }
    });

    it("an accept that loses to a withdrawal is refused and leaves the event open", async () => {
      const { booking, event } = await applied();
      // The owner's request read "applied"; the withdrawal lands before its write.
      expect(await applyTransition(testDb.db, booking.id, "withdraw", "applicant")).toBe(true);

      expect(await applyTransition(testDb.db, booking.id, "accept", "owner")).toBe(false);

      expect(await statusOf(booking.id)).toBe("canceled");
      expect(await isFulfilled(event.id)).toBe(false);
    });
  });
});
