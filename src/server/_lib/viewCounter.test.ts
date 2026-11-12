import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import { isLikelyBot, recordEventView, recordProfileView, utcDay, viewSourceFromReferer } from "./viewCounter";

const ORIGIN = "https://myiso.app";
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const NOW = new Date("2030-06-15T23:59:00.000Z");

describe("isLikelyBot", () => {
  it.each([
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "facebookexternalhit/1.1",
    "Slackbot-LinkExpanding 1.0",
    "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0 Safari/537.36",
    "curl/8.4.0",
    "python-requests/2.31",
    "WhatsApp/2.23.20",
    "",
    "short",
  ])("treats %j as automated", (agent) => {
    expect(isLikelyBot(agent)).toBe(true);
  });

  it("treats a missing user agent as automated", () => {
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot(undefined)).toBe(true);
  });

  it.each([
    BROWSER,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  ])("counts a browser: %s", (agent) => {
    expect(isLikelyBot(agent)).toBe(false);
  });
});

describe("viewSourceFromReferer", () => {
  it.each([
    [null, "direct"],
    ["", "direct"],
    ["not a url", "direct"],
    ["https://example.com/app/search?q=me", "external"],
    [`${ORIGIN}/app/search?q=wedding`, "search"],
    [`${ORIGIN}/app/search`, "search"],
    [`${ORIGIN}/app/events/abc`, "event"],
    [`${ORIGIN}/app/events`, "event"],
    [`${ORIGIN}/app/discover/matches`, "discover"],
    [`${ORIGIN}/app/messages/t1`, "messages"],
    [`${ORIGIN}/app/bookings`, "bookings"],
    [`${ORIGIN}/app/photographer/u2`, "profile"],
    [`${ORIGIN}/photographer/olive`, "profile"],
    [`${ORIGIN}/app/searchlight`, "other"],
    [`${ORIGIN}/`, "other"],
  ] as const)("%j is %s", (referer, source) => {
    expect(viewSourceFromReferer(referer, ORIGIN)).toBe(source);
  });
});

describe("utcDay", () => {
  it("is the UTC calendar day", () => {
    expect(utcDay(NOW)).toBe("2030-06-15");
    expect(utcDay(new Date("2030-06-16T00:00:00.000Z"))).toBe("2030-06-16");
  });
});

describe("view counters against SQLite", () => {
  let testDb: TestDb;
  let owner: { id: string };
  let viewer: { id: string };

  const visit = { isPrefetch: false, ownOrigin: ORIGIN, referer: `${ORIGIN}/app/search?q=x`, userAgent: BROWSER };

  beforeEach(async () => {
    testDb = await createTestDb();
    owner = await createTestUser(testDb.db);
    viewer = await createTestUser(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  const profileView = (overrides: Partial<Parameters<typeof recordProfileView>[1]> = {}) =>
    recordProfileView(testDb.db, {
      ...visit,
      now: NOW,
      pagePaths: [`/app/photographer/${owner.id}`],
      profileUserId: owner.id,
      viewerId: viewer.id,
      ...overrides,
    });

  it("keeps one row per (profile, day, source) and raises its count", async () => {
    await expect(profileView()).resolves.toBe("counted");
    await expect(profileView()).resolves.toBe("counted");
    await expect(profileView({ referer: null })).resolves.toBe("counted");
    await expect(profileView({ now: new Date("2030-06-16T00:00:01.000Z") })).resolves.toBe("counted");

    const rows = await testDb.db.profileView.findMany({ orderBy: [{ day: "asc" }, { source: "asc" }] });
    expect(rows).toEqual([
      { count: 1, day: "2030-06-15", source: "direct", userId: owner.id },
      { count: 2, day: "2030-06-15", source: "search", userId: owner.id },
      { count: 1, day: "2030-06-16", source: "search", userId: owner.id },
    ]);
  });

  it("never stores who looked: the table has no column for a viewer", async () => {
    await profileView();
    const columns = await testDb.raw.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("ProfileView")`);
    expect(columns.map((column) => column.name).sort()).toEqual(["count", "day", "source", "userId"]);
    const eventColumns = await testDb.raw.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("EventView")`);
    expect(eventColumns.map((column) => column.name).sort()).toEqual(["count", "day", "eventId"]);
  });

  it("does not count the owner looking at their own profile", async () => {
    await expect(profileView({ viewerId: owner.id })).resolves.toBe("self");
    expect(await testDb.db.profileView.count()).toBe(0);
  });

  it("does not count bots, prefetches or a refresh of the same page", async () => {
    await expect(profileView({ userAgent: "Googlebot/2.1" })).resolves.toBe("bot");
    await expect(profileView({ isPrefetch: true })).resolves.toBe("prefetch");
    await expect(profileView({ referer: `${ORIGIN}/app/photographer/${owner.id}` })).resolves.toBe("refresh");
    expect(await testDb.db.profileView.count()).toBe(0);
  });

  it("counts a signed-out visitor to the public page", async () => {
    await expect(profileView({ pagePaths: ["/photographer/olive"], referer: "https://instagram.com/", viewerId: null })).resolves.toBe(
      "counted",
    );
    expect(await testDb.db.profileView.findFirst()).toMatchObject({ count: 1, source: "external" });
  });

  it("counts concurrent views without losing any", async () => {
    await Promise.all(Array.from({ length: 20 }, () => profileView()));
    expect(await testDb.db.profileView.findFirst()).toMatchObject({ count: 20 });
  });

  describe("event views", () => {
    async function event() {
      const photographer = await testDb.db.photographer.create({
        data: { companyName: "Studio", location: "Austin", name: "Owner", userId: owner.id },
      });
      return testDb.db.event.create({
        data: { date: new Date("2031-01-01T00:00:00Z"), location: "Austin", photographerId: photographer.id, title: "Wedding" },
      });
    }

    it("counts per (event, day), skipping the owner, bots, prefetches and refreshes", async () => {
      const { id } = await event();
      const view = (overrides: Partial<Parameters<typeof recordEventView>[1]> = {}) =>
        recordEventView(testDb.db, {
          ...visit,
          eventId: id,
          now: NOW,
          ownerId: owner.id,
          pagePath: `/app/events/${id}`,
          viewerId: viewer.id,
          ...overrides,
        });

      await expect(view()).resolves.toBe("counted");
      await expect(view()).resolves.toBe("counted");
      await expect(view({ viewerId: owner.id })).resolves.toBe("self");
      await expect(view({ userAgent: "Twitterbot/1.0" })).resolves.toBe("bot");
      await expect(view({ isPrefetch: true })).resolves.toBe("prefetch");
      await expect(view({ referer: `${ORIGIN}/app/events/${id}` })).resolves.toBe("refresh");

      expect(await testDb.db.eventView.findMany()).toEqual([{ count: 2, day: "2030-06-15", eventId: id }]);
    });
  });
});
