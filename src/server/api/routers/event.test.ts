import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorReason } from "~/_utils/errorReason";
import { reasonOf } from "~/server/api/reasonedError";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));

import { eventRouter } from "./event";

type TestUser = { email: string; id: string };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("events feed", () => {
  let testDb: TestDb;
  let owner: TestUser;
  let viewer: TestUser;
  let photographerId: string;

  const as = (user: TestUser) => createDbCaller(eventRouter, testDb.db, { user });

  async function createEvent(title: string, offsetMs: number, overrides: { isDeleted?: boolean; location?: string } = {}) {
    return testDb.db.event.create({
      data: {
        date: new Date(Date.now() + offsetMs),
        location: "Austin, TX",
        photographerId,
        title,
        ...overrides,
      },
    });
  }

  /** Every page of the feed, following nextCursor. */
  async function allPages(input: { limit: number; locations?: string[]; when?: "upcoming" | "past" }) {
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = await as(viewer).getFeedPage({ ...input, cursor });
      pages.push(page.items.map((event) => event.title));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return pages;
  }

  beforeEach(async () => {
    testDb = await createTestDb();
    owner = await createTestUser(testDb.db);
    viewer = await createTestUser(testDb.db);
    photographerId = (
      await testDb.db.photographer.create({
        data: { avatar: "https://example.com/a.jpg", companyName: "Co", location: "Austin, TX", name: "Olive Owner", userId: owner.id },
      })
    ).id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("returns upcoming events, soonest first, by default", async () => {
    await createEvent("in three days", 3 * DAY_MS);
    await createEvent("tomorrow", DAY_MS);
    await createEvent("in an hour", HOUR_MS);
    await createEvent("yesterday", -DAY_MS);
    await createEvent("an hour ago", -HOUR_MS);

    const page = await as(viewer).getFeedPage({});

    expect(page.items.map((event) => event.title)).toEqual(["in an hour", "tomorrow", "in three days"]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]?.photographer).toEqual({
      avatar: "https://example.com/a.jpg",
      name: "Olive Owner",
      userId: owner.id,
    });
  });

  it("returns past events, most recent first, on request", async () => {
    await createEvent("tomorrow", DAY_MS);
    await createEvent("last week", -7 * DAY_MS);
    await createEvent("an hour ago", -HOUR_MS);
    await createEvent("yesterday", -DAY_MS);

    const page = await as(viewer).getFeedPage({ when: "past" });

    expect(page.items.map((event) => event.title)).toEqual(["an hour ago", "yesterday", "last week"]);
  });

  it("pages with nextCursor without repeating or skipping, in both directions", async () => {
    for (let day = 1; day <= 5; day++) await createEvent(`+${day}`, day * DAY_MS);
    for (let day = 1; day <= 3; day++) await createEvent(`-${day}`, -day * DAY_MS);

    expect(await allPages({ limit: 2 })).toEqual([["+1", "+2"], ["+3", "+4"], ["+5"]]);
    expect(await allPages({ limit: 2, when: "past" })).toEqual([["-1", "-2"], ["-3"]]);
    // A page that ends exactly at the end has no next cursor.
    expect((await as(viewer).getFeedPage({ limit: 5 })).nextCursor).toBeNull();
  });

  it("skips nothing when the cursor event starts (leaves the upcoming feed) between two requests", async () => {
    const soon = await createEvent("+1", DAY_MS);
    for (let day = 2; day <= 4; day++) await createEvent(`+${day}`, day * DAY_MS);
    const first = await as(viewer).getFeedPage({ limit: 1 });
    expect(first.items.map((event) => event.title)).toEqual(["+1"]);

    // Time passes: the last event of page one has begun.
    await testDb.db.event.update({ data: { date: new Date(Date.now() - HOUR_MS) }, where: { id: soon.id } });
    const second = await as(viewer).getFeedPage({ cursor: first.nextCursor ?? undefined, limit: 2 });

    // Still everything that was after it; "+2" is not swallowed.
    expect(second.items.map((event) => event.title)).toEqual(["+2", "+3"]);
    const third = await as(viewer).getFeedPage({ cursor: second.nextCursor ?? undefined, limit: 2 });
    expect(third).toMatchObject({ items: [{ title: "+4" }], nextCursor: null });
  });

  it("skips nothing when the cursor event is deleted between two requests, in either direction", async () => {
    for (let day = 1; day <= 4; day++) await createEvent(`+${day}`, day * DAY_MS);
    for (let day = 1; day <= 4; day++) await createEvent(`-${day}`, -day * DAY_MS);

    for (const [when, expected] of [["upcoming", ["+3", "+4"]], ["past", ["-3", "-4"]]] as const) {
      const first = await as(viewer).getFeedPage({ limit: 2, when });
      await testDb.raw.event.update({ data: { isDeleted: true }, where: { id: first.items.at(-1)?.id ?? "" } });

      const second = await as(viewer).getFeedPage({ cursor: first.nextCursor ?? undefined, limit: 2, when });

      expect(second.items.map((event) => event.title)).toEqual(expected);
      expect(second.nextCursor).toBeNull();
    }
  });

  describe("timestamps are text", () => {
    const storedDates = async () =>
      (await testDb.raw.$queryRaw<Array<{ date: string }>>`SELECT CAST("date" AS TEXT) AS "date" FROM "Event"`).map((row) => row.date);
    /** Rewrites the events titled so as hand-written SQL would have stored them: "...Z". */
    const spellWithZ = (titles: string[]) =>
      testDb.raw.$executeRawUnsafe(
        `UPDATE "Event" SET "date" = replace("date", '+00:00', 'Z') WHERE "title" IN (${titles.map((title) => `'${title}'`).join(", ")})`,
      );

    it("Prisma stores every timestamp in ONE spelling, ending in +00:00 (the same on D1: both adapters format dates alike)", async () => {
      await createEvent("+1", DAY_MS);
      await testDb.db.event.update({ data: { date: new Date(Date.now() + 2 * DAY_MS) }, where: { id: (await testDb.db.event.findFirstOrThrow()).id } });

      // If an adapter upgrade ever changes this, the note in docs/DATABASE.md
      // and the seed file have to change with it.
      for (const date of await storedDates()) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);
    });

    it("does not repeat or skip the cursor event when rows at OTHER instants are spelled with Z", async () => {
      for (let day = 1; day <= 3; day++) await createEvent(`+${day}`, day * DAY_MS);
      for (let day = 1; day <= 3; day++) await createEvent(`-${day}`, -day * DAY_MS);
      await spellWithZ(["+1", "+2", "-1", "-2"]);
      expect((await storedDates()).filter((date) => date.endsWith("Z"))).toHaveLength(4);

      expect(await allPages({ limit: 1 })).toEqual([["+1"], ["+2"], ["+3"]]);
      expect(await allPages({ limit: 1, when: "past" })).toEqual([["-1"], ["-2"], ["-3"]]);
    });

    it("two events at the SAME instant in two spellings: paged one at a time, each appears exactly once after the documented normalisation", async () => {
      const at = new Date(Date.now() + DAY_MS);
      const [first, second] = [
        await testDb.db.event.create({ data: { date: at, id: "evt_a", location: "Austin, TX", photographerId, title: "a" } }),
        await testDb.db.event.create({ data: { date: at, id: "evt_b", location: "Austin, TX", photographerId, title: "b" } }),
      ];
      // "a", the one with the smaller id, was written by hand with Z.
      await spellWithZ(["a"]);

      // Text order puts "+00:00" before "Z" whatever the ids are, so the
      // feed's (date, id) keyset does not hold across spellings: this is
      // the state the normalisation exists for, not one the app supports.
      const mixed = await testDb.raw.event.findMany({ orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true } });
      expect(mixed.map((event) => event.id)).toEqual([second.id, first.id]);

      // The one-off statement from docs/DATABASE.md.
      await testDb.raw.$executeRaw`UPDATE "Event" SET "date" = replace("date", 'Z', '+00:00') WHERE "date" LIKE '%Z'`;

      expect(await allPages({ limit: 1 })).toEqual([["a"], ["b"]]);
      await testDb.raw.event.updateMany({ data: { date: new Date(Date.now() - DAY_MS) } });
      expect(await allPages({ limit: 1, when: "past" })).toEqual([["b"], ["a"]]);
    });
  });

  it("keeps the page boundary where it was when the cursor event is rescheduled LATER: the events in between are not skipped", async () => {
    for (let day = 1; day <= 4; day++) await createEvent(`+${day}`, day * DAY_MS);
    const first = await as(viewer).getFeedPage({ limit: 2 });
    expect(first.items.map((event) => event.title)).toEqual(["+1", "+2"]);

    // The owner moves the last event of page one from day 2 to day 5.
    await testDb.db.event.update({ data: { date: new Date(Date.now() + 5 * DAY_MS) }, where: { id: first.items.at(-1)?.id ?? "" } });
    const second = await as(viewer).getFeedPage({ cursor: first.nextCursor ?? undefined, limit: 2 });

    // Day 3 and day 4 come next, as they would have.
    expect(second.items.map((event) => event.title)).toEqual(["+3", "+4"]);
    // The moved event is then met at its new place.
    const third = await as(viewer).getFeedPage({ cursor: second.nextCursor ?? undefined, limit: 2 });
    expect(third).toMatchObject({ items: [{ title: "+2" }], nextCursor: null });
  });

  it("keeps the page boundary where it was when the cursor event is rescheduled EARLIER: nothing already shown is repeated", async () => {
    for (let day = 2; day <= 5; day++) await createEvent(`+${day}`, day * DAY_MS);
    for (let day = 2; day <= 5; day++) await createEvent(`-${day}`, -day * DAY_MS);

    const first = await as(viewer).getFeedPage({ limit: 2 });
    expect(first.items.map((event) => event.title)).toEqual(["+2", "+3"]);
    // Day 3 is brought forward to day 1, before everything on page one.
    await testDb.db.event.update({ data: { date: new Date(Date.now() + DAY_MS) }, where: { id: first.items.at(-1)?.id ?? "" } });
    const second = await as(viewer).getFeedPage({ cursor: first.nextCursor ?? undefined, limit: 5 });
    expect(second.items.map((event) => event.title)).toEqual(["+4", "+5"]);

    // The same for the past feed (most recent first).
    const past = await as(viewer).getFeedPage({ limit: 2, when: "past" });
    expect(past.items.map((event) => event.title)).toEqual(["-2", "-3"]);
    await testDb.raw.event.update({ data: { date: new Date(Date.now() - HOUR_MS) }, where: { id: past.items.at(-1)?.id ?? "" } });
    const older = await as(viewer).getFeedPage({ cursor: past.nextCursor ?? undefined, limit: 5, when: "past" });
    expect(older.items.map((event) => event.title)).toEqual(["-4", "-5"]);
  });

  it("refuses anything that is not a cursor it issued", async () => {
    const event = await createEvent("+1", DAY_MS);
    await createEvent("+2", 2 * DAY_MS);
    const issued = (await as(viewer).getFeedPage({ limit: 1 })).nextCursor ?? "";
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

    // The cursor is a token, not the event's id.
    expect(issued).not.toBe(event.id);
    for (const cursor of [
      "no-such-event",
      event.id,
      "!!!",
      encode({ date: 1, id: "x" }),
      encode(["2031-01-01", event.id]),
      encode([Date.now(), ""]),
      encode([Date.now()]),
      encode([-5, event.id]),
      `${issued}AAAA`,
    ]) {
      await expect(as(viewer).getFeedPage({ cursor })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(as(viewer).getFeedPage({ cursor: issued })).resolves.toMatchObject({ items: [{ title: "+2" }] });
  });

  it("combines the cursor with the city filter", async () => {
    for (let day = 1; day <= 3; day++) {
      await createEvent(`austin +${day}`, day * DAY_MS);
      await createEvent(`denver +${day}`, day * DAY_MS, { location: "Denver, CO" });
    }

    expect(await allPages({ limit: 2, locations: ["Denver"] })).toEqual([["denver +1", "denver +2"], ["denver +3"]]);
  });

  describe("isFulfilled", () => {
    async function acceptedBookingOn(eventId: string) {
      const applicant = await createTestUser(testDb.db);
      await testDb.db.booking.create({ data: { applicantId: applicant.id, eventId, ownerId: owner.id, status: "accepted" } });
    }

    it("is derived from the bookings on every read, whatever the stored column says", async () => {
      // The write of the column failed after the booking was accepted...
      const filled = await createEvent("filled", DAY_MS);
      await acceptedBookingOn(filled.id);
      // ...and here it was left set after the booking was cancelled.
      const open = await createEvent("open", 2 * DAY_MS);
      await testDb.raw.event.update({ data: { isFulfilled: true }, where: { id: open.id } });

      const expected = [{ isFulfilled: true, title: "filled" }, { isFulfilled: false, title: "open" }];
      expect((await as(viewer).getFeedPage({})).items).toMatchObject(expected);
      expect(await as(viewer).getRecentByLocation({ locations: [] })).toMatchObject([...expected].reverse());
      expect(await as(viewer).getByPhotographerId({ photographerId })).toMatchObject([...expected].reverse());
      expect(
        await as(viewer).search({ afterDate: new Date(), beforeDate: new Date(Date.now() + 9 * DAY_MS), query: "e" }),
      ).toMatchObject(expected);
    });

    it("reading one event derives the value too, and leaves the legacy column alone", async () => {
      const filled = await createEvent("filled", DAY_MS);
      await acceptedBookingOn(filled.id);
      const open = await createEvent("open", 2 * DAY_MS);
      await testDb.raw.event.update({ data: { isFulfilled: true }, where: { id: open.id } });
      const stored = async (id: string) => (await testDb.raw.event.findUniqueOrThrow({ where: { id } })).isFulfilled;

      expect((await as(viewer).getById({ id: filled.id })).isFulfilled).toBe(true);
      expect((await as(viewer).getById({ id: open.id })).isFulfilled).toBe(false);

      // Nothing depends on the column, so nothing writes it either.
      expect(await stored(filled.id)).toBe(false);
      expect(await stored(open.id)).toBe(true);
    });

    it("editing an event answers with the derived value, not the stored column", async () => {
      const filled = await createEvent("filled", DAY_MS);
      await acceptedBookingOn(filled.id);
      const open = await createEvent("open", 2 * DAY_MS);
      await testDb.raw.event.update({ data: { isFulfilled: true }, where: { id: open.id } });

      expect(await as(owner).update({ id: filled.id, title: "filled, renamed" })).toMatchObject({ isFulfilled: true, title: "filled, renamed" });
      expect(await as(owner).update({ id: open.id, title: "open, renamed" })).toMatchObject({ isFulfilled: false, title: "open, renamed" });
    });

    it("does not count a deleted booking, or one that does not hold the slot", async () => {
      const event = await createEvent("open", DAY_MS);
      const [first, second] = [await createTestUser(testDb.db), await createTestUser(testDb.db)];
      await testDb.db.booking.create({ data: { applicantId: first.id, eventId: event.id, isDeleted: true, ownerId: owner.id, status: "accepted" } });
      await testDb.db.booking.create({ data: { applicantId: second.id, eventId: event.id, ownerId: owner.id, status: "applied" } });

      expect((await as(viewer).getById({ id: event.id })).isFulfilled).toBe(false);
    });
  });

  it("keeps a stable order for events at the same time", async () => {
    const at = new Date(Date.now() + DAY_MS);
    for (const title of ["a", "b", "c", "d"]) {
      await testDb.db.event.create({ data: { date: at, location: "Austin, TX", photographerId, title } });
    }

    const titles = (await allPages({ limit: 1 })).flat();

    expect([...titles].sort()).toEqual(["a", "b", "c", "d"]);
    expect(new Set(titles).size).toBe(4);
  });

  it("leaves out deleted events and filters by city", async () => {
    await createEvent("austin", DAY_MS);
    await createEvent("deleted", DAY_MS, { isDeleted: true });
    await createEvent("denver", 2 * DAY_MS, { location: "Denver, CO" });

    expect((await allPages({ limit: 10 })).flat()).toEqual(["austin", "denver"]);
    expect((await allPages({ limit: 10, locations: ["Denver, CO, USA"] })).flat()).toEqual(["denver"]);
    expect((await allPages({ limit: 10, locations: ["Austin", "Denver"] })).flat()).toEqual(["austin", "denver"]);
  });

  it("validates its input and requires a session", async () => {
    await expect(as(viewer).getFeedPage({ limit: 51 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // @ts-expect-error not a feed
    await expect(as(viewer).getFeedPage({ when: "all" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(createDbCaller(eventRouter, testDb.db).getFeedPage({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("the legacy feed keeps its shape (a plain array, latest first)", async () => {
    await createEvent("tomorrow", DAY_MS);
    await createEvent("yesterday", -DAY_MS);

    const events = await as(viewer).getRecentByLocation({ locations: [] });

    expect(events.map((event) => event.title)).toEqual(["tomorrow", "yesterday"]);
  });

  describe("getById", () => {
    it("answers NOT_FOUND with a typed reason for a missing or deleted event", async () => {
      const deleted = await createEvent("gone", DAY_MS, { isDeleted: true });

      for (const id of ["missing", deleted.id]) {
        const error = await as(viewer).getById({ id }).then(
          () => null,
          (caught: unknown) => caught,
        );
        expect(error).toMatchObject({ code: "NOT_FOUND" });
        expect(reasonOf(error)).toBe(ErrorReason.EVENT_NOT_FOUND);
      }
    });

    it("returns a live event", async () => {
      const event = await createEvent("here", DAY_MS);

      await expect(as(viewer).getById({ id: event.id })).resolves.toMatchObject({ commentCount: 0, title: "here" });
    });
  });
});
