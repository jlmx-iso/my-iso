// The booking state machine against real SQLite: the conditional writes,
// who cancelled, the event's single slot, and the derived isFulfilled.
// (The router tests, src/server/api/routers/booking.test.ts, go through
// the procedures; these pin the module's own contract.)

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import {
  applyTransition,
  canReapply,
  checkTransition,
  isSlotTaken,
  withDerivedFulfilled,
} from "./bookingTransitions";

let testDb: TestDb;
let ownerId: string;
let photographerId: string;

beforeEach(async () => {
  testDb = await createTestDb();
  const owner = await createTestUser(testDb.db);
  ownerId = owner.id;
  const photographer = await testDb.db.photographer.create({
    data: { companyName: "Studio", location: "Austin, TX", name: "Owner", userId: owner.id },
  });
  photographerId = photographer.id;
});

afterEach(async () => {
  await testDb.close();
});

async function createEvent() {
  return testDb.db.event.create({
    data: {
      date: new Date(Date.UTC(2031, 0, 1)),
      duration: 2,
      location: "Austin, TX",
      photographerId,
      title: "Wedding",
    },
  });
}

async function createBooking(eventId: string, status: string) {
  const applicant = await createTestUser(testDb.db);
  return testDb.db.booking.create({ data: { applicantId: applicant.id, eventId, ownerId, status } });
}

const statusOf = async (id: string) =>
  (await testDb.db.booking.findUniqueOrThrow({ select: { cancelOrigin: true, status: true }, where: { id } }));

describe("checkTransition", () => {
  const event = { date: new Date(Date.UTC(2031, 0, 1)), duration: 2 };
  const before = new Date(Date.UTC(2030, 11, 31));

  it("names why a transition is refused", () => {
    expect(checkTransition("accept", "applicant", { status: "applied" }, event, before)).toBe("not_allowed");
    expect(checkTransition("accept", "owner", { status: "declined" }, event, before)).toBe("invalid_transition");
    expect(checkTransition("accept", "owner", { status: "applied" }, event, event.date)).toBe("event_started");
    expect(checkTransition("complete", "owner", { status: "accepted" }, event, event.date)).toBe("not_yet_completable");
    expect(checkTransition("accept", "owner", { status: "applied" }, event, before)).toBeNull();
  });
});

describe("applyTransition", () => {
  it("writes the target status of each action", async () => {
    const event = await createEvent();
    const declined = await createBooking(event.id, "applied");
    const withdrawn = await createBooking(event.id, "applied");

    expect(await applyTransition(testDb.db, declined.id, "decline", "owner")).toBe(true);
    expect(await applyTransition(testDb.db, withdrawn.id, "withdraw", "applicant")).toBe(true);

    expect(await statusOf(declined.id)).toEqual({ cancelOrigin: null, status: "declined" });
    expect(await statusOf(withdrawn.id)).toEqual({ cancelOrigin: "withdrawn", status: "canceled" });
  });

  it("records who cancelled an accepted booking", async () => {
    const byApplicant = await createBooking((await createEvent()).id, "accepted");
    const byOwner = await createBooking((await createEvent()).id, "accepted");

    expect(await applyTransition(testDb.db, byApplicant.id, "cancel", "applicant")).toBe(true);
    expect(await applyTransition(testDb.db, byOwner.id, "cancel", "owner")).toBe(true);

    expect(await statusOf(byApplicant.id)).toEqual({ cancelOrigin: "canceled_by_applicant", status: "canceled" });
    expect(await statusOf(byOwner.id)).toEqual({ cancelOrigin: "canceled_by_owner", status: "canceled" });
  });

  it("refuses a second accept on the event, but still lets the owner decline others", async () => {
    const event = await createEvent();
    const first = await createBooking(event.id, "applied");
    const second = await createBooking(event.id, "applied");
    const third = await createBooking(event.id, "applied");

    expect(await applyTransition(testDb.db, first.id, "accept", "owner")).toBe(true);
    expect(await applyTransition(testDb.db, second.id, "accept", "owner")).toBe(false);
    // The slot condition applies to accepting only.
    expect(await applyTransition(testDb.db, third.id, "decline", "owner")).toBe(true);
    expect(await applyTransition(testDb.db, first.id, "complete", "owner")).toBe(true);
    expect((await statusOf(second.id)).status).toBe("applied");
  });
});

describe("isSlotTaken", () => {
  it("counts accepted and completed bookings, except the one named", async () => {
    const event = await createEvent();
    expect(await isSlotTaken(testDb.db, event.id)).toBe(false);

    const completed = await createBooking(event.id, "completed");
    expect(await isSlotTaken(testDb.db, event.id)).toBe(true);
    expect(await isSlotTaken(testDb.db, event.id, completed.id)).toBe(false);

    const other = await createEvent();
    await createBooking(other.id, "applied");
    expect(await isSlotTaken(testDb.db, other.id)).toBe(false);
  });
});

describe("canReapply", () => {
  it("only after a withdrawal that left the booking cancelled", () => {
    expect(canReapply({ cancelOrigin: "withdrawn", status: "canceled" })).toBe(true);
    expect(canReapply({ cancelOrigin: "canceled_by_applicant", status: "canceled" })).toBe(false);
    expect(canReapply({ cancelOrigin: "withdrawn", status: "applied" })).toBe(false);
    expect(canReapply({ cancelOrigin: null, status: "canceled" })).toBe(false);
  });
});

describe("withDerivedFulfilled", () => {
  it("derives isFulfilled across more events than one lookup takes", async () => {
    const events = [];
    for (let i = 0; i < 170; i++) events.push(await createEvent());
    // One fulfilled event in each lookup chunk (80 ids each), the last one last.
    const fulfilledIds = [events[3], events[85], events[169]].map((event) => event!.id);
    await createBooking(fulfilledIds[0]!, "accepted");
    await createBooking(fulfilledIds[1]!, "completed");
    await createBooking(fulfilledIds[2]!, "accepted");
    await createBooking(events[4]!.id, "applied");

    const derived = await withDerivedFulfilled(testDb.db, events);

    expect(derived).toHaveLength(170);
    expect(derived.filter((event) => event.isFulfilled).map((event) => event.id)).toEqual(fulfilledIds);
    expect(derived[0]).toMatchObject({ id: events[0]!.id, title: "Wedding" });
  });

  it("asks nothing for no events", async () => {
    expect(await withDerivedFulfilled(testDb.db, [])).toEqual([]);
  });
});
