import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import {
  countView,
  decodeViewCookie,
  encodeViewCookie,
  isLikelyBot,
  memoryViewLimiter,
  memoryViewLimiters,
  purgeViewSeen,
  secondsToEndOfDay,
  targetToken,
  utcDay,
  VIEW_ANON_LIMIT,
  VIEW_COOKIE_MAX_TARGETS,
  VIEW_RATE_LIMIT,
  verifiedViewSource,
  VIEW_SOURCE_TOKEN_GRACE_MS,
  viewSourceFromReferer,
  viewSourceToken,
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
    // Compared as the router serves it: case, escapes and a trailing slash
    // do not change the answer.
    ["HTTPS://MyISO.app/App/Search", "search"],
    [`${ORIGIN}/app/%73earch?q=x`, "search"],
    [`${ORIGIN}/app/search/`, "search"],
    [`${ORIGIN}/photographer/%40Olive`, "profile"],
    [`${ORIGIN}/app/%E0%A4%A`, "other"],
    [`${ORIGIN}:443/app/events/1`, "event"],
  ] as const)("%j is %s", (referer, source) => {
    expect(viewSourceFromReferer(referer, ORIGIN)).toBe(source);
  });

  it("knows only the configured origin: the same path on another host is external", () => {
    expect(viewSourceFromReferer("https://preview.myiso.app/app/search", ORIGIN)).toBe("external");
    expect(viewSourceFromReferer("http://myiso.app/app/search", ORIGIN)).toBe("external");
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

  it("stands in for both bindings with the limits wrangler.toml gives them", () => {
    const toml = readFileSync(path.resolve(__dirname, "../../../wrangler.toml"), "utf8");
    const limitOf = (name: string) =>
      [...toml.matchAll(new RegExp(`name = "${name}"\\s+namespace_id = "\\d+"\\s+simple = \\{ limit = (\\d+), period = (\\d+) \\}`, "g"))].map(
        (match) => ({ limit: Number(match[1]), periodSeconds: Number(match[2]) }),
      );
    // Production and staging.
    expect(limitOf("VIEW_COUNT_LIMIT")).toEqual([VIEW_RATE_LIMIT, VIEW_RATE_LIMIT]);
    expect(limitOf("VIEW_ANON_LIMIT")).toEqual([VIEW_ANON_LIMIT, VIEW_ANON_LIMIT]);
  });
});

describe("countView against SQLite", () => {
  let testDb: TestDb;
  let owner: { id: string };
  let viewer: { id: string };
  let eventId: string;
  /** A token the page would have issued for the default request: owner's profile, "search", DAY. */
  let searchToken: string;

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
    searchToken = await viewSourceToken({ id: owner.id, kind: "profile" }, "search", DAY);
  });

  afterEach(async () => {
    await testDb.close();
  });

  const profileView = (overrides: Partial<ViewRequest> = {}): ViewRequest => ({
    clientIp: "203.0.113.7",
    cookie: null,
    now: NOW,
    source: "search",
    sourceToken: searchToken,
    target: { id: owner.id, kind: "profile" },
    userAgent: BROWSER,
    viewerId: viewer.id,
    ...overrides,
  });
  const sources = async () =>
    (await testDb.db.profileView.findMany({ orderBy: { source: "asc" } })).map((row) => [row.source, row.count]);
  const total = async () => (await testDb.db.profileView.aggregate({ _sum: { count: true } }))._sum.count ?? 0;

  it("two identical requests from one browser count once", async () => {
    const limiter = memoryViewLimiters();
    const first = await countView(testDb.db, limiter, profileView());
    expect(first.outcome).toBe("counted");
    const second = await countView(testDb.db, limiter, profileView({ cookie: first.cookie }));
    expect(second).toEqual({ cookie: null, outcome: "already_counted" });
    expect(await testDb.db.profileView.findMany()).toEqual([{ count: 1, day: DAY, source: "search", userId: owner.id }]);
  });

  it("counts again the next UTC day", async () => {
    const limiter = memoryViewLimiters();
    const first = await countView(testDb.db, limiter, profileView());
    const nextDay = await countView(testDb.db, limiter, profileView({ cookie: first.cookie, now: new Date("2030-06-16T08:00:00Z") }));
    expect(nextDay.outcome).toBe("counted");
    expect(await testDb.db.profileView.count()).toBe(2);
  });

  it("a cookie-less loop from one address counts once, and reaches the database at most the rate limit", async () => {
    const limiter = memoryViewLimiters();
    const execute = vi.spyOn(testDb.db, "$executeRaw");
    const outcomes: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      outcomes.push((await countView(testDb.db, limiter, profileView({ viewerId: null }))).outcome);
    }
    expect(outcomes.filter((outcome) => outcome === "counted")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "already_counted")).toHaveLength(VIEW_RATE_LIMIT.limit - 1);
    expect(outcomes.filter((outcome) => outcome === "rate_limited")).toHaveLength(100 - VIEW_RATE_LIMIT.limit);
    // One "seen" insert per admitted request, and one count.
    expect(execute).toHaveBeenCalledTimes(VIEW_RATE_LIMIT.limit + 1);
    expect(await total()).toBe(1);
  });

  it("signed out, an address counts once a day per target whatever its cookie, and the key names no address", async () => {
    const limiter = memoryViewLimiters();
    const anonymous = (overrides: Partial<ViewRequest> = {}) => profileView({ viewerId: null, ...overrides });
    expect((await countView(testDb.db, limiter, anonymous())).outcome).toBe("counted");
    // Cookie dropped: the same address is not counted again today.
    expect((await countView(testDb.db, limiter, anonymous({ cookie: null }))).outcome).toBe("already_counted");
    // Another address is; so is the same one tomorrow.
    expect((await countView(testDb.db, limiter, anonymous({ clientIp: "198.51.100.77" }))).outcome).toBe("counted");
    expect((await countView(testDb.db, limiter, anonymous({ now: new Date("2030-06-16T01:00:00Z") }))).outcome).toBe("counted");
    expect(await total()).toBe(3);
    const seen = JSON.stringify(await testDb.raw.viewSeen.findMany());
    expect(seen).not.toContain("203.0.113.7");
    expect(seen).not.toContain("198.51.100.77");
  });

  it("a member counts once a day per target on any device, and the database learns no name", async () => {
    const limiter = memoryViewLimiters();
    // Two devices: neither sends the other's cookie.
    expect((await countView(testDb.db, limiter, profileView())).outcome).toBe("counted");
    const otherDevice = await countView(testDb.db, limiter, profileView({ source: "direct" }));
    expect(otherDevice.outcome).toBe("already_counted");
    // The second device is told too, so it does not ask again today.
    expect(await decodeViewCookie(otherDevice.cookie, DAY)).toEqual([await targetToken({ id: owner.id, kind: "profile" })]);
    expect(await total()).toBe(1);

    const seen = await testDb.raw.viewSeen.findMany();
    expect(seen).toEqual([{ day: DAY, key: expect.stringMatching(/^[0-9a-f]{32}$/) }]);
    expect(JSON.stringify(seen)).not.toContain(viewer.id);
    expect(JSON.stringify(seen)).not.toContain(owner.id);

    // Another member, and the next day, count again.
    const someoneElse = await createTestUser(testDb.db);
    expect((await countView(testDb.db, limiter, profileView({ viewerId: someoneElse.id }))).outcome).toBe("counted");
    expect((await countView(testDb.db, limiter, profileView({ now: new Date("2030-06-16T09:00:00Z") }))).outcome).toBe("counted");
    expect(await total()).toBe(3);

    // Yesterday's keys go; today's stay.
    expect(await purgeViewSeen(testDb.db, new Date("2030-06-16T09:00:00Z"))).toBe(2);
    expect(await testDb.raw.viewSeen.count()).toBe(1);
  });

  it("all signed-out views together write at most the anonymous cap, however many addresses send them", async () => {
    const limiter = memoryViewLimiters();
    const execute = vi.spyOn(testDb.db, "$executeRaw");
    let counted = 0;
    for (let index = 0; index < VIEW_ANON_LIMIT.limit + 30; index += 1) {
      const result = await countView(testDb.db, limiter, profileView({ clientIp: `198.51.${Math.floor(index / 250)}.${index % 250}`, viewerId: null }));
      if (result.outcome === "counted") counted += 1;
    }
    expect(counted).toBe(VIEW_ANON_LIMIT.limit);
    // Each admitted view: one "seen" insert and one count.
    expect(execute).toHaveBeenCalledTimes(2 * VIEW_ANON_LIMIT.limit);
    // Members are not held back by it.
    expect((await countView(testDb.db, limiter, profileView())).outcome).toBe("counted");
  });

  it("files a view under its source only with the page's token; a forged source counts as Other", async () => {
    const limiter = memoryViewLimiters();
    // The page's token: counted under Search.
    expect((await countView(testDb.db, limiter, profileView())).outcome).toBe("counted");
    // A client claiming "search" with no token, or with one it made up.
    const second = await createTestUser(testDb.db);
    const third = await createTestUser(testDb.db);
    expect((await countView(testDb.db, limiter, profileView({ sourceToken: null, viewerId: second.id }))).outcome).toBe("counted");
    expect((await countView(testDb.db, limiter, profileView({ sourceToken: "0".repeat(32), viewerId: third.id }))).outcome).toBe("counted");
    // Search's token presented with another source.
    const fourth = await createTestUser(testDb.db);
    await countView(testDb.db, limiter, profileView({ source: "messages", viewerId: fourth.id }));
    expect(await sources()).toEqual([["other", 3], ["search", 1]]);
  });

  it("verifiedViewSource binds the token to the target, the source and the UTC day", async () => {
    const target = { id: owner.id, kind: "profile" } as const;
    const token = await viewSourceToken(target, "search", DAY);
    expect(await verifiedViewSource(target, "search", token, NOW)).toBe("search");
    // Another target, or the same id as an event.
    expect(await verifiedViewSource({ id: viewer.id, kind: "profile" }, "search", token, NOW)).toBe("other");
    expect(await verifiedViewSource({ id: owner.id, kind: "event" }, "search", token, NOW)).toBe("other");
    expect(await verifiedViewSource(target, "event", token, NOW)).toBe("other");
    expect(await verifiedViewSource(target, "search", undefined, NOW)).toBe("other");
    // Rendered just before midnight, reported just after: still accepted.
    const justAfter = new Date(Date.parse("2030-06-16T00:00:00Z") + VIEW_SOURCE_TOKEN_GRACE_MS - 1000);
    expect(await verifiedViewSource(target, "search", token, justAfter)).toBe("search");
    // A stale day: past the grace, or two days on.
    expect(await verifiedViewSource(target, "search", token, new Date(Date.parse("2030-06-16T00:00:00Z") + VIEW_SOURCE_TOKEN_GRACE_MS))).toBe("other");
    expect(await verifiedViewSource(target, "search", token, new Date("2030-06-17T00:01:00Z"))).toBe("other");
    // A token for tomorrow is not accepted today either.
    expect(await verifiedViewSource(target, "search", await viewSourceToken(target, "search", "2030-06-16"), NOW)).toBe("other");
  });

  it("a refused request touches no table at all", async () => {
    const refuse = { limit: async () => ({ success: false }) };
    const refuseAll = { anonymous: refuse, perClient: refuse };
    const find = vi.spyOn(testDb.db.photographer, "findFirst");
    expect((await countView(testDb.db, refuseAll, profileView())).outcome).toBe("rate_limited");
    expect(find).not.toHaveBeenCalled();
  });

  it("does not count the signed-in owner, and remembers that in the cookie", async () => {
    const limiter = memoryViewLimiters();
    const own = await countView(testDb.db, limiter, profileView({ viewerId: owner.id }));
    expect(own.outcome).toBe("self");
    expect((await countView(testDb.db, limiter, profileView({ cookie: own.cookie, viewerId: owner.id }))).outcome).toBe(
      "already_counted",
    );
    expect(await total()).toBe(0);
  });

  it("the owner signed out with the same visitor cookie is not counted again that day", async () => {
    const limiter = memoryViewLimiters();
    const signedIn = await countView(testDb.db, limiter, profileView({ viewerId: owner.id }));
    const signedOut = await countView(testDb.db, limiter, profileView({ cookie: signedIn.cookie, viewerId: null }));
    expect(signedOut.outcome).toBe("already_counted");
    expect(await total()).toBe(0);
  });

  it("does not count bots, nor a profile that does not exist", async () => {
    const limiter = memoryViewLimiters();
    expect((await countView(testDb.db, limiter, profileView({ userAgent: "Googlebot/2.1" }))).outcome).toBe("bot");
    expect((await countView(testDb.db, limiter, profileView({ target: { id: "nobody", kind: "profile" } }))).outcome).toBe("not_found");
    expect(await total()).toBe(0);
  });

  it("stops counting a signed-out browser that has been counted for the day's maximum, not a member", async () => {
    const tokens = await Promise.all(
      Array.from({ length: VIEW_COOKIE_MAX_TARGETS }, (_, index) => targetToken({ id: `p${index}`, kind: "profile" })),
    );
    const full = await encodeViewCookie(DAY, tokens);
    const limiter = memoryViewLimiters();
    expect((await countView(testDb.db, limiter, profileView({ cookie: full, viewerId: null }))).outcome).toBe("cookie_full");
    // A member is deduped by ViewSeen, so a full cookie does not stop them;
    // the cookie keeps the newest targets, at most the maximum.
    const member = await countView(testDb.db, limiter, profileView({ cookie: full }));
    expect(member.outcome).toBe("counted");
    const kept = await decodeViewCookie(member.cookie, DAY);
    expect(kept).toHaveLength(VIEW_COOKIE_MAX_TARGETS);
    expect(kept.at(-1)).toBe(await targetToken({ id: owner.id, kind: "profile" }));
  });

  it("counts event views per (event, day) for signed-in members only", async () => {
    const limiter = memoryViewLimiters();
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
    const limiter = memoryViewLimiters();
    await Promise.all(Array.from({ length: 20 }, (_, index) => countView(testDb.db, limiter, profileView({ clientIp: `198.51.100.${index}`, viewerId: null }))));
    expect(await total()).toBe(20);
  });
});
