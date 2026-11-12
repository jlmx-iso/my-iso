import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import {
  countView,
  decodeViewCookie,
  encodeViewCookie,
  isLikelyBot,
  memoryViewLimiter,
  secondsToEndOfDay,
  targetToken,
  utcDay,
  VIEW_COOKIE_MAX_TARGETS,
  VIEW_RATE_LIMIT,
  viewSourceFromReferer,
  type ViewRequest,
} from "./viewCounter";

const ORIGIN = "https://myiso.app";
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const NOW = new Date("2030-06-15T23:59:00.000Z");
const DAY = "2030-06-15";

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
    ["https://myiso.app.evil.example/app/search", "external"],
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

describe("utcDay and the cookie's lifetime", () => {
  it("is the UTC calendar day", () => {
    expect(utcDay(NOW)).toBe(DAY);
    expect(utcDay(new Date("2030-06-16T00:00:00.000Z"))).toBe("2030-06-16");
  });

  it("expires the cookie at the end of the UTC day", () => {
    expect(secondsToEndOfDay(NOW)).toBe(60);
    expect(secondsToEndOfDay(new Date("2030-06-15T00:00:00.000Z"))).toBe(86_400);
  });
});

describe("the dedupe cookie", () => {
  it("round-trips the day's tokens", async () => {
    const tokens = [await targetToken({ id: "u1", kind: "profile" }), await targetToken({ id: "e1", kind: "event" })];
    expect(await decodeViewCookie(await encodeViewCookie(DAY, tokens), DAY)).toEqual(tokens);
    expect(await decodeViewCookie(await encodeViewCookie(DAY, []), DAY)).toEqual([]);
  });

  it("holds no identity: only the day and short keyed hashes", async () => {
    const value = await encodeViewCookie(DAY, [await targetToken({ id: "user_123", kind: "profile" })]);
    expect(value).toMatch(/^2030-06-15\.[0-9a-f]{12}\.[0-9a-f]{24}$/);
    expect(value).not.toContain("user_123");
  });

  it("lists nothing for another day, a forged list or a damaged value", async () => {
    const token = await targetToken({ id: "u1", kind: "profile" });
    const good = await encodeViewCookie(DAY, [token]);
    expect(await decodeViewCookie(good, "2030-06-16")).toEqual([]);
    expect(await decodeViewCookie(good.replace(token, "0".repeat(12)), DAY)).toEqual([]);
    expect(await decodeViewCookie(`${DAY}.${token}.${"0".repeat(24)}`, DAY)).toEqual([]);
    expect(await decodeViewCookie("garbage", DAY)).toEqual([]);
    expect(await decodeViewCookie(null, DAY)).toEqual([]);
  });

  it("separates profiles from events with the same id", async () => {
    expect(await targetToken({ id: "x", kind: "profile" })).not.toBe(await targetToken({ id: "x", kind: "event" }));
  });
});

describe("memoryViewLimiter", () => {
  it("admits `limit` per key per window, then forgets", async () => {
    let clock = 0;
    const limiter = memoryViewLimiter(2, 1000, () => clock);
    expect((await limiter.limit({ key: "a" })).success).toBe(true);
    expect((await limiter.limit({ key: "a" })).success).toBe(true);
    expect((await limiter.limit({ key: "a" })).success).toBe(false);
    expect((await limiter.limit({ key: "b" })).success).toBe(true);
    clock = 1000;
    expect((await limiter.limit({ key: "a" })).success).toBe(true);
  });
});

describe("countView against SQLite", () => {
  let testDb: TestDb;
  let owner: { id: string };
  let viewer: { id: string };
  let eventId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    owner = await createTestUser(testDb.db);
    viewer = await createTestUser(testDb.db);
    const photographer = await testDb.db.photographer.create({
      data: { companyName: "Studio", location: "Austin", name: "Owner", userId: owner.id },
    });
    eventId = (
      await testDb.db.event.create({
        data: { date: new Date("2031-01-01T00:00:00Z"), location: "Austin", photographerId: photographer.id, title: "Wedding" },
      })
    ).id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  const profileView = (overrides: Partial<ViewRequest> = {}): ViewRequest => ({
    clientIp: "203.0.113.7",
    cookie: null,
    now: NOW,
    source: "search",
    target: { id: owner.id, kind: "profile" },
    userAgent: BROWSER,
    viewerId: viewer.id,
    ...overrides,
  });
  const total = async () => (await testDb.db.profileView.aggregate({ _sum: { count: true } }))._sum.count ?? 0;

  it("two identical requests from one browser count once", async () => {
    const limiter = memoryViewLimiter();
    const first = await countView(testDb.db, limiter, profileView());
    expect(first.outcome).toBe("counted");
    const second = await countView(testDb.db, limiter, profileView({ cookie: first.cookie }));
    expect(second).toEqual({ cookie: null, outcome: "already_counted" });
    expect(await testDb.db.profileView.findMany()).toEqual([{ count: 1, day: DAY, source: "search", userId: owner.id }]);
  });

  it("counts again the next UTC day", async () => {
    const limiter = memoryViewLimiter();
    const first = await countView(testDb.db, limiter, profileView());
    const nextDay = await countView(testDb.db, limiter, profileView({ cookie: first.cookie, now: new Date("2030-06-16T08:00:00Z") }));
    expect(nextDay.outcome).toBe("counted");
    expect(await testDb.db.profileView.count()).toBe(2);
  });

  it("a cookie-less loop from one address writes at most the rate limit", async () => {
    const limiter = memoryViewLimiter();
    const execute = vi.spyOn(testDb.db, "$executeRaw");
    const outcomes = [];
    for (let index = 0; index < 100; index += 1) {
      outcomes.push((await countView(testDb.db, limiter, profileView({ viewerId: null }))).outcome);
    }
    expect(outcomes.filter((outcome) => outcome === "counted")).toHaveLength(VIEW_RATE_LIMIT.limit);
    expect(outcomes.filter((outcome) => outcome === "rate_limited")).toHaveLength(100 - VIEW_RATE_LIMIT.limit);
    expect(execute).toHaveBeenCalledTimes(VIEW_RATE_LIMIT.limit);
    expect(await total()).toBe(VIEW_RATE_LIMIT.limit);
  });

  it("a refused request touches no table at all", async () => {
    const refuseAll = { limit: async () => ({ success: false }) };
    const find = vi.spyOn(testDb.db.photographer, "findFirst");
    expect((await countView(testDb.db, refuseAll, profileView())).outcome).toBe("rate_limited");
    expect(find).not.toHaveBeenCalled();
  });

  it("does not count the signed-in owner, and remembers that in the cookie", async () => {
    const limiter = memoryViewLimiter();
    const own = await countView(testDb.db, limiter, profileView({ viewerId: owner.id }));
    expect(own.outcome).toBe("self");
    expect((await countView(testDb.db, limiter, profileView({ cookie: own.cookie, viewerId: owner.id }))).outcome).toBe(
      "already_counted",
    );
    expect(await total()).toBe(0);
  });

  it("the owner signed out with the same visitor cookie is not counted again that day", async () => {
    const limiter = memoryViewLimiter();
    const signedIn = await countView(testDb.db, limiter, profileView({ viewerId: owner.id }));
    const signedOut = await countView(testDb.db, limiter, profileView({ cookie: signedIn.cookie, viewerId: null }));
    expect(signedOut.outcome).toBe("already_counted");
    expect(await total()).toBe(0);
  });

  it("does not count bots, nor a profile that does not exist", async () => {
    const limiter = memoryViewLimiter();
    expect((await countView(testDb.db, limiter, profileView({ userAgent: "Googlebot/2.1" }))).outcome).toBe("bot");
    expect((await countView(testDb.db, limiter, profileView({ target: { id: "nobody", kind: "profile" } }))).outcome).toBe("not_found");
    expect(await total()).toBe(0);
  });

  it("stops counting a browser that has been counted for the day's maximum", async () => {
    const tokens = await Promise.all(
      Array.from({ length: VIEW_COOKIE_MAX_TARGETS }, (_, index) => targetToken({ id: `p${index}`, kind: "profile" })),
    );
    const full = await encodeViewCookie(DAY, tokens);
    expect((await countView(testDb.db, memoryViewLimiter(), profileView({ cookie: full }))).outcome).toBe("cookie_full");
  });

  it("counts event views per (event, day) for signed-in members only", async () => {
    const limiter = memoryViewLimiter();
    const event = (overrides: Partial<ViewRequest> = {}) => profileView({ target: { id: eventId, kind: "event" }, ...overrides });
    expect((await countView(testDb.db, limiter, event({ viewerId: null }))).outcome).toBe("sign_in_required");
    const first = await countView(testDb.db, limiter, event());
    expect(first.outcome).toBe("counted");
    expect((await countView(testDb.db, limiter, event({ cookie: first.cookie }))).outcome).toBe("already_counted");
    expect((await countView(testDb.db, limiter, event({ viewerId: owner.id }))).outcome).toBe("self");
    expect(await testDb.db.eventView.findMany()).toEqual([{ count: 1, day: DAY, eventId }]);
  });

  it("never stores who looked: the tables have no column for a viewer", async () => {
    const columns = await testDb.raw.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("ProfileView")`);
    expect(columns.map((column) => column.name).sort()).toEqual(["count", "day", "source", "userId"]);
    const eventColumns = await testDb.raw.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("EventView")`);
    expect(eventColumns.map((column) => column.name).sort()).toEqual(["count", "day", "eventId"]);
  });

  it("counts concurrent views from different browsers without losing any", async () => {
    const limiter = memoryViewLimiter(100);
    await Promise.all(Array.from({ length: 20 }, (_, index) => countView(testDb.db, limiter, profileView({ clientIp: `198.51.100.${index}`, viewerId: null }))));
    expect(await total()).toBe(20);
  });
});
