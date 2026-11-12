import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));

import { likeContains, rankedPhotographerIds, searchRouter } from "./search";

freezeRateLimitClock();

const DAY_MS = 24 * 60 * 60 * 1000;

const LEGACY = {
  isActive: false,
  isCanceled: false,
  isExpired: false,
  isPaused: false,
  isPending: false,
  isTrial: false,
};

describe("search: photographers", () => {
  let testDb: TestDb;
  let searcher: { email: string; id: string };

  const search = (input: Parameters<ReturnType<typeof caller>["searchAll"]>[0]) => caller().searchAll(input);
  const caller = () => createDbCaller(searchRouter, testDb.db, { user: searcher });
  const names = (rows: Array<{ name: string }>) => rows.map((row) => row.name);

  async function photographer(
    name: string,
    options: { bio?: string; companyName?: string; location?: string; pro?: "active" | "lapsed" | "ending"; ends?: Date } = {},
  ) {
    const user = await createTestUser(testDb.db);
    if (options.pro) {
      await testDb.db.subscription.create({
        data: {
          ...LEGACY,
          cancelAt: options.pro === "ending" ? (options.ends ?? null) : options.pro === "lapsed" ? new Date(Date.now() - DAY_MS) : null,
          cancelAtPeriodEnd: options.pro !== "active",
          isLifetime: false,
          status: "active",
          userId: user.id,
        },
      });
    }
    return testDb.db.photographer.create({
      data: {
        bio: options.bio ?? null,
        companyName: options.companyName ?? "Studio",
        location: options.location ?? "Austin, TX",
        name,
        userId: user.id,
      },
    });
  }

  beforeEach(async () => {
    testDb = await createTestDb();
    searcher = await createTestUser(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("ranks Pro members first within a relevance tier, then by name", async () => {
    await photographer("Ann Wedding");
    await photographer("Zed Wedding", { pro: "active" });
    await photographer("Bea Wedding");
    await photographer("Max Wedding", { pro: "active" });

    const result = await search({ filters: { type: "photographers" }, query: "wedding" });

    expect(names(result.photographers)).toEqual(["Max Wedding", "Zed Wedding", "Ann Wedding", "Bea Wedding"]);
    expect(result.photographers.map((row) => row.isPro)).toEqual([true, true, false, false]);
  });

  it("never lets priority beat relevance: a name match outranks a Pro bio-only match", async () => {
    await photographer("Pro Person", { bio: "I love weddings", pro: "active" });
    await photographer("Cal Wedding");
    await photographer("Dee Lee", { companyName: "Wedding Co", pro: "active" });

    const result = await search({ query: "wedding" });

    expect(names(result.photographers)).toEqual(["Cal Wedding", "Dee Lee", "Pro Person"]);
  });

  it("does not let priority override filters: a Pro member outside the location is not shown", async () => {
    await photographer("Ann Wedding", { location: "Austin, TX" });
    await photographer("Zed Wedding", { location: "Denver, CO", pro: "active" });

    const result = await search({ location: "Austin", query: "wedding" });

    expect(names(result.photographers)).toEqual(["Ann Wedding"]);
  });

  it("stops ranking a lapsed subscription as Pro", async () => {
    await photographer("Ann Wedding");
    await photographer("Zed Wedding", { pro: "lapsed" });

    const result = await search({ query: "wedding" });

    expect(names(result.photographers)).toEqual(["Ann Wedding", "Zed Wedding"]);
    expect(result.photographers.every((row) => !row.isPro)).toBe(true);
  });

  it("drops a member from the Pro tier the moment their access ends, with no write", async () => {
    const ends = new Date("2031-01-01T00:00:00.000Z");
    await photographer("Ann Wedding");
    await photographer("Zed Wedding", { ends, pro: "ending" });

    const before = await rankedPhotographerIds(testDb.db, { limit: 10, now: new Date(ends.getTime() - 1), offset: 0, query: "wedding" });
    const after = await rankedPhotographerIds(testDb.db, { limit: 10, now: ends, offset: 0, query: "wedding" });

    const zed = await testDb.db.photographer.findFirstOrThrow({ where: { name: "Zed Wedding" } });
    expect(before[0]).toBe(zed.id);
    expect(after[1]).toBe(zed.id);
  });

  it("pages deterministically: no one skipped or repeated, ties broken by id", async () => {
    for (let index = 0; index < 7; index += 1) {
      await photographer("Same Name Wedding", { pro: index % 3 === 0 ? "active" : undefined });
    }

    const pages = [];
    for (let offset = 0; offset < 7; offset += 3) {
      pages.push(...(await search({ filters: { type: "photographers" }, limit: 3, offset, query: "wedding" })).photographers);
    }
    const again = await search({ filters: { type: "photographers" }, limit: 7, query: "wedding" });

    expect(pages.map((row) => row.id)).toEqual(again.photographers.map((row) => row.id));
    expect(new Set(pages.map((row) => row.id)).size).toBe(7);
    // Pro first, and within each group by id.
    const pro = pages.filter((row) => row.isPro).map((row) => row.id);
    const free = pages.filter((row) => !row.isPro).map((row) => row.id);
    expect(pages.map((row) => row.id)).toEqual([...pro, ...free]);
    expect(pro).toEqual([...pro].sort());
    expect(free).toEqual([...free].sort());
  });

  it("matches LIKE's wildcards literally and ignores ASCII case", async () => {
    await photographer("100% Weddings");
    await photographer("1000 Weddings");
    await photographer("snake_case");
    await photographer("snakeXcase");

    expect(names((await search({ query: "100%" })).photographers)).toEqual(["100% Weddings"]);
    expect(names((await search({ query: "e_c" })).photographers)).toEqual(["snake_case"]);
    expect(names((await search({ query: "WEDDINGS" })).photographers)).toEqual(["100% Weddings", "1000 Weddings"]);
  });

  it("returns the person, portfolio and badge of each result, in one batch per page", async () => {
    const zed = await photographer("Zed Wedding", { pro: "active" });
    await testDb.db.portfolioImage.create({
      data: { image: "https://res.cloudinary.com/x/1.jpg", isFeatured: true, photographerId: zed.id, tags: "[]", title: "Kiss" },
    });
    const findMany = vi.spyOn(testDb.db.subscription, "findMany");
    try {
      const result = await search({ filters: { type: "photographers" }, query: "wedding" });
      expect(result.photographers[0]).toMatchObject({
        isPro: true,
        name: "Zed Wedding",
        portfolioImages: [{ title: "Kiss" }],
        user: { id: zed.userId },
      });
      expect(findMany).toHaveBeenCalledTimes(1);
    } finally {
      findMany.mockRestore();
    }
  });

  it("finds nothing without asking for details", async () => {
    await photographer("Ann Wedding");
    const result = await search({ filters: { type: "photographers" }, query: "portrait" });
    expect(result).toEqual({ events: [], photographers: [] });
  });
});

describe("search: events", () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("marks the owner of each event as Pro or not", async () => {
    const searcher = await createTestUser(testDb.db);
    const proOwner = await createTestUser(testDb.db);
    const freeOwner = await createTestUser(testDb.db);
    await testDb.db.subscription.create({ data: { ...LEGACY, isLifetime: true, status: "active", userId: proOwner.id } });
    for (const [owner, title] of [[proOwner, "Pro wedding"], [freeOwner, "Free wedding"]] as const) {
      const profile = await testDb.db.photographer.create({
        data: { companyName: "Studio", location: "Austin", name: title, userId: owner.id },
      });
      await testDb.db.event.create({
        data: { date: new Date("2031-05-01T12:00:00Z"), location: "Austin", photographerId: profile.id, title },
      });
    }

    const result = await createDbCaller(searchRouter, testDb.db, { user: searcher }).searchAll({
      filters: { type: "events" },
      query: "wedding",
    });

    expect(result.photographers).toEqual([]);
    expect(Object.fromEntries(result.events.map((event) => [event.title, event.photographer.isPro]))).toEqual({
      "Free wedding": false,
      "Pro wedding": true,
    });
  });
});

describe("likeContains", () => {
  it("escapes LIKE's special characters", () => {
    expect(likeContains("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});
