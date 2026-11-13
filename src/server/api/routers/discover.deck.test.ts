import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAfterResponse } from "~/server/_lib/background";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, D1_CONNECTION_INFO, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
// Nothing runs after the response here; what matters is whether it is asked to.
vi.mock("~/server/_lib/background", () => ({ runAfterResponse: vi.fn() }));
// No AI calls in tests.
vi.mock("~/server/_lib/ai", () => ({
  generateIcebreakers: vi.fn(async () => []),
  generateMatchSummary: vi.fn(async () => null),
  isAiEnabled: () => true,
  parseStoredIcebreakers: (value: string | null) => (value ? (JSON.parse(value) as string[]) : null),
}));

import { discoverRouter } from "./discover";

type TestUser = { email: string; id: string };

const HOUR_MS = 60 * 60 * 1000;

freezeRateLimitClock();

let testDb: TestDb;
/** Statements of the D1-shaped run, while `recording` is on. */
const statements: { params: number; sql: string }[] = [];
let recording = false;

const as = (user: TestUser) => createDbCaller(discoverRouter, testDb.db, { user });

beforeAll(async () => {
  testDb = await createTestDb({
    d1: {
      onStatement: (statement) => {
        if (recording) statements.push(statement);
      },
    },
  });
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  const { raw } = testDb;
  await raw.rateLimit.deleteMany();
  await raw.notification.deleteMany();
  await raw.match.deleteMany();
  await raw.swipe.deleteMany();
  await raw.message.deleteMany();
  await raw.messageThread.deleteMany();
  await raw.review.deleteMany();
  await raw.event.deleteMany();
  await raw.portfolioImage.deleteMany();
  await raw.photographer.deleteMany();
  await raw.user.deleteMany();
  vi.mocked(runAfterResponse).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  statements.length = 0;
  recording = false;
});

afterEach(() => {
  vi.useRealTimers();
});

type Candidate = {
  bio?: string;
  city?: string;
  isDiscoverable?: boolean;
  location?: string;
  state?: string;
  tags?: string[][];
  updatedDaysAgo?: number;
};

async function photographer(firstName: string, options: Candidate = {}) {
  const user = await createTestUser(testDb.db, { firstName, isDiscoverable: options.isDiscoverable ?? true });
  await testDb.raw.user.update({
    data: {
      city: options.city ?? null,
      state: options.state ?? null,
      updatedAt: new Date(Date.now() - (options.updatedDaysAgo ?? 0) * 24 * HOUR_MS),
    },
    where: { id: user.id },
  });
  const profile = await testDb.db.photographer.create({
    data: {
      bio: options.bio ?? null,
      companyName: `${firstName} Co`,
      location: options.location ?? "",
      name: firstName,
      userId: user.id,
    },
  });
  for (const [index, tags] of (options.tags ?? []).entries()) {
    await testDb.db.portfolioImage.create({
      data: {
        image: `https://res.cloudinary.com/test-cloud/${firstName}-${index}.jpg`,
        isFeatured: index === 0,
        photographerId: profile.id,
        tags: JSON.stringify(tags),
        title: `${firstName} ${index}`,
      },
    });
  }
  return { photographerId: profile.id, user: { email: user.email, id: user.id } };
}

async function review(photographerId: string, rating: number) {
  const reviewer = await createTestUser(testDb.db);
  await testDb.db.review.create({ data: { photographerId, rating, title: "Review", userId: reviewer.id } });
}

describe("discover.getCardDeck", () => {
  it("ranks a candidate in the viewer's city above one in their state above the rest", async () => {
    const viewer = await createTestUser(testDb.db, { firstName: "Viewer" });
    await testDb.db.user.update({ data: { city: "Austin", state: "TX" }, where: { id: viewer.id } });
    await photographer("Elsewhere", { city: "Denver", state: "CO" });
    await photographer("SameState", { city: "Houston", state: "tx" });
    await photographer("SameCity", { city: "AUSTIN", state: "TX" });
    // A city named only in the photographer's location still counts.
    await photographer("ByLocation", { location: "Austin, Texas" });

    const deck = await as(viewer).getCardDeck({ limit: 10 });

    const names = deck.map((card) => card.firstName);
    // The two city matches score the same for location.
    expect(names.slice(0, 2).sort()).toEqual(["ByLocation", "SameCity"]);
    expect(names.slice(2)).toEqual(["SameState", "Elsewhere"]);
  });

  it("weighs reviews, the specialities sought and recent activity", async () => {
    const viewer = await createTestUser(testDb.db, { firstName: "Viewer" });
    await as(viewer).updatePreferences({ seekingTypes: ["Wedding", "Portrait"] });
    const reviewed = await photographer("Reviewed");
    for (let i = 0; i < 10; i++) await review(reviewed.photographerId, 5);
    await photographer("Specialist", { bio: "Wedding photographer", tags: [["portrait"], ["not", "json"]] });
    await photographer("Idle", { updatedDaysAgo: 120 });
    await photographer("Recent");

    const deck = await as(viewer).getCardDeck({ limit: 10 });

    // 25 for ten five-star reviews, 20 for both specialities, 15 for being
    // active today, 0 for four months away.
    expect(deck.map((card) => card.firstName)).toEqual(["Reviewed", "Specialist", "Recent", "Idle"]);
    const top = deck[0]?.photographer;
    expect(top).toMatchObject({ avgRating: 5, eventCount: 0, reviewCount: 10 });
    expect(top).not.toHaveProperty("score");
    expect(deck[1]?.photographer).toMatchObject({ avgRating: null, reviewCount: 0, specializations: ["portrait", "not", "json"] });
  });

  it("skips tags that are not a JSON list and repeats no speciality", async () => {
    const viewer = await createTestUser(testDb.db, { firstName: "Viewer" });
    await as(viewer).updatePreferences({ seekingTypes: ["Wedding"] });
    const candidate = await photographer("Tagged", { tags: [["wedding", "film"], ["wedding"]] });
    await testDb.db.portfolioImage.create({
      data: { image: "x.jpg", isFeatured: false, photographerId: candidate.photographerId, tags: "{broken", title: "Broken" },
    });

    const [card] = await as(viewer).getCardDeck({ limit: 10 });

    expect(card?.photographer?.specializations).toEqual(["wedding", "film"]);
  });

  it("leaves out the viewer, the undiscoverable, members without a profile, deleted accounts and anyone swiped on", async () => {
    const viewer = await photographer("Viewer");
    const shown = await photographer("Shown");
    await photographer("Hidden", { isDiscoverable: false });
    await createTestUser(testDb.db, { firstName: "NoProfile", isDiscoverable: true });
    const deleted = await photographer("Deleted");
    await testDb.raw.user.update({ data: { isDeleted: true }, where: { id: deleted.user.id } });
    const passed = await photographer("Passed");
    await as(viewer.user).swipe({ direction: "pass", targetId: passed.user.id });

    const deck = await as(viewer.user).getCardDeck({ limit: 10 });

    expect(deck.map((card) => card.id)).toEqual([shown.user.id]);
  });

  it("returns at most `limit` cards", async () => {
    const viewer = await createTestUser(testDb.db, { firstName: "Viewer" });
    for (let i = 0; i < 4; i++) await photographer(`P${i}`);

    await expect(as(viewer).getCardDeck({ limit: 2 })).resolves.toHaveLength(2);
  });

  it("stays within D1's bound-parameter limit with more candidates and swipes than fit in one statement", async () => {
    const viewer = await createTestUser(testDb.db, { firstName: "Viewer" });
    const candidates = [];
    for (let i = 0; i < 130; i++) candidates.push(await photographer(`C${i}`, { tags: [["wedding"]] }));
    // More swipes than D1 could take as an `id NOT IN (...)` list.
    await testDb.db.swipe.createMany({
      data: candidates.slice(0, 110).map(({ user }) => ({ direction: "pass", swiperId: viewer.id, targetId: user.id })),
    });

    recording = true;
    const deck = await as(viewer).getCardDeck({ limit: 50 });
    recording = false;

    expect(deck.map((card) => card.id).sort()).toEqual(candidates.slice(110).map(({ user }) => user.id).sort());
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.params, statement.sql).toBeLessThanOrEqual(D1_CONNECTION_INFO.maxBindValues);
    }
  });

  it("reports a failure as a server error", async () => {
    const viewer = await createTestUser(testDb.db, { firstName: "Viewer" });
    // A stored preference that is not JSON: the deck cannot be scored.
    await testDb.db.user.update({ data: { seekingTypes: "{not json" }, where: { id: viewer.id } });

    await expect(as(viewer).getCardDeck({ limit: 5 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to load discover deck. Please try again.",
    });
  });
});

describe("discover.swipe edge cases", () => {
  it("records a pass without looking for a match", async () => {
    const alice = await photographer("Alice");
    const bob = await photographer("Bob");
    await as(bob.user).swipe({ direction: "like", targetId: alice.user.id });

    await expect(as(alice.user).swipe({ direction: "pass", targetId: bob.user.id })).resolves.toEqual({
      matched: false,
      matchId: null,
      threadId: null,
    });
    await expect(testDb.db.match.count()).resolves.toBe(0);
  });

  it("refuses a deleted account as a target, the same way as an unknown one", async () => {
    const alice = await photographer("Alice");
    const bob = await photographer("Bob");
    await testDb.raw.user.update({ data: { isDeleted: true }, where: { id: bob.user.id } });

    await expect(as(alice.user).swipe({ direction: "like", targetId: bob.user.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "This profile is not available",
    });
  });

  it("makes no match with an account deleted after it liked the swiper", async () => {
    const alice = await photographer("Alice");
    const bob = await photographer("Bob");
    await as(bob.user).swipe({ direction: "like", targetId: alice.user.id });
    await testDb.raw.user.update({ data: { isDeleted: true }, where: { id: bob.user.id } });

    await expect(as(alice.user).swipe({ direction: "like", targetId: bob.user.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(testDb.db.match.count()).resolves.toBe(0);
  });

  it("matches for 72 hours, notifies both, and starts the insights after the response", async () => {
    vi.useFakeTimers({ now: Date.UTC(2030, 5, 1, 12), toFake: ["Date"] });
    const alice = await photographer("Alice");
    const bob = await photographer("Bob");
    await as(alice.user).swipe({ direction: "like", targetId: bob.user.id });

    const result = await as(bob.user).swipe({ direction: "like", targetId: alice.user.id });

    expect(result.matched).toBe(true);
    const match = await testDb.db.match.findUniqueOrThrow({ where: { id: result.matchId ?? "" } });
    expect(match.expiresAt?.getTime()).toBe(Date.UTC(2030, 5, 1, 12) + 72 * HOUR_MS);
    await expect(testDb.db.notification.count({ where: { type: "new_match" } })).resolves.toBe(2);
    expect(runAfterResponse).toHaveBeenCalledWith("match-insights", expect.any(Function));
  });

  it("wraps an unexpected failure in a server error", async () => {
    const alice = await photographer("Alice");
    const bob = await photographer("Bob");
    const broken = new Proxy(testDb.db, {
      get(target, prop) {
        if (prop === "swipe") {
          return { create: () => Promise.reject(new Error("disk I/O error")) };
        }
        return Reflect.get(target, prop) as unknown;
      },
    });

    await expect(
      createDbCaller(discoverRouter, broken, { user: alice.user }).swipe({ direction: "like", targetId: bob.user.id }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Failed to record swipe. Please try again." });
  });
});

describe("discover.getMatches and getMatchById", () => {
  async function matched() {
    const alice = await photographer("Alice", { city: "Austin" });
    const bob = await photographer("Bob", { city: "Boston" });
    await as(alice.user).swipe({ direction: "like", targetId: bob.user.id });
    const { matchId } = await as(bob.user).swipe({ direction: "like", targetId: alice.user.id });
    if (!matchId) throw new Error("no match");
    return { alice, bob, matchId };
  }

  it("shows each side the other person", async () => {
    const { alice, bob, matchId } = await matched();

    const [forAlice] = await as(alice.user).getMatches({});
    const [forBob] = await as(bob.user).getMatches({});

    expect(forAlice).toMatchObject({ id: matchId, otherUser: { city: "Boston", id: bob.user.id } });
    expect(forBob).toMatchObject({ id: matchId, otherUser: { city: "Austin", id: alice.user.id } });
  });

  it("drops a match from the list once its 72 hours pass without a message", async () => {
    const { alice, matchId } = await matched();
    vi.useFakeTimers({ now: Date.now() + 72 * HOUR_MS + 60_000, toFake: ["Date"] });

    await expect(as(alice.user).getMatches({})).resolves.toEqual([]);
    const detail = await as(alice.user).getMatchById({ matchId });
    expect(detail).toMatchObject({ icebreakersStatus: "unavailable", status: "expired" });
    expect(runAfterResponse).not.toHaveBeenCalledWith("match-icebreakers", expect.any(Function));
  });

  it("generates missing icebreakers after the response for a live match", async () => {
    const { alice, matchId } = await matched();

    const detail = await as(alice.user).getMatchById({ matchId });

    expect(detail).toMatchObject({ icebreakers: [], icebreakersStatus: "pending", status: "matched" });
    expect(runAfterResponse).toHaveBeenCalledWith("match-icebreakers", expect.any(Function));
  });

  it("serves stored icebreakers without generating them again", async () => {
    const { alice, matchId } = await matched();
    await testDb.db.match.update({ data: { icebreakers: JSON.stringify(["Film or digital?"]) }, where: { id: matchId } });

    await expect(as(alice.user).getMatchById({ matchId })).resolves.toMatchObject({
      icebreakers: ["Film or digital?"],
      icebreakersStatus: "ready",
    });
    expect(runAfterResponse).not.toHaveBeenCalledWith("match-icebreakers", expect.any(Function));
  });

  it("does not show a match to anyone outside it", async () => {
    const { matchId } = await matched();
    const outsider = await photographer("Eve");

    await expect(as(outsider.user).getMatchById({ matchId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists up to D1's limits without an oversized statement", async () => {
    const viewer = await photographer("Viewer");
    for (let i = 0; i < 55; i++) {
      const other = await createTestUser(testDb.db, { firstName: `M${i}` });
      const [user1Id, user2Id] = viewer.user.id < other.id ? [viewer.user.id, other.id] : [other.id, viewer.user.id];
      await testDb.db.match.create({ data: { expiresAt: new Date(Date.now() + HOUR_MS), user1Id, user2Id } });
    }

    recording = true;
    const page = await as(viewer.user).getMatches({ limit: 50 });
    recording = false;

    expect(page).toHaveLength(50);
    for (const statement of statements) {
      expect(statement.params, statement.sql).toBeLessThanOrEqual(D1_CONNECTION_INFO.maxBindValues);
    }
  });

  it("reports failures as server errors", async () => {
    const viewer = await photographer("Viewer");
    const broken = new Proxy(testDb.db, {
      get(target, prop) {
        if (prop === "match" || prop === "user") {
          const fail = () => Promise.reject(new Error("D1 unavailable"));
          return { findFirst: fail, findMany: fail, findUnique: fail, update: fail };
        }
        return Reflect.get(target, prop) as unknown;
      },
    });
    const caller = createDbCaller(discoverRouter, broken, { user: viewer.user });

    await expect(caller.getMatches({})).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    await expect(caller.getMatchById({ matchId: "m-1" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    await expect(caller.getPreferences()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    await expect(caller.updatePreferences({ isDiscoverable: false })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("discover preferences", () => {
  it("saves only the fields given and reads them back", async () => {
    const viewer = await photographer("Viewer");

    await as(viewer.user).updatePreferences({ budgetMax: 900, budgetMin: 300, seekingTypes: ["wedding"] });
    await as(viewer.user).updatePreferences({ isDiscoverable: false });

    await expect(as(viewer.user).getPreferences()).resolves.toEqual({
      budgetMax: 900,
      budgetMin: 300,
      isDiscoverable: false,
      photographer: { avatar: null },
      seekingTypes: ["wedding"],
    });
  });

  it("has defaults for a member with nothing set and no profile", async () => {
    const member = await createTestUser(testDb.db);

    await expect(as(member).getPreferences()).resolves.toEqual({
      budgetMax: null,
      budgetMin: null,
      isDiscoverable: false,
      photographer: null,
      seekingTypes: [],
    });
  });
});
