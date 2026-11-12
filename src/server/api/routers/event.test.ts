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
