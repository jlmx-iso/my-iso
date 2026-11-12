import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { threadParticipantKey } from "~/server/_db/messaging";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
// No AI calls in tests.
vi.mock("~/server/_lib/ai", () => ({
  generateIcebreakers: vi.fn(async () => []),
  generateMatchSummary: vi.fn(async () => null),
}));

import { discoverRouter } from "./discover";

type TestUser = { email: string; id: string };

// Limiter windows are slices of wall-clock time; see freezeRateLimitClock.
freezeRateLimitClock();

describe("discoverRouter.swipe against SQLite", () => {
  let testDb: TestDb;
  let alice: TestUser;
  let bob: TestUser;

  const as = (user: TestUser) => createDbCaller(discoverRouter, testDb.db, { user });

  async function createDiscoverableUser(firstName: string, isDiscoverable = true) {
    const user = await createTestUser(testDb.db, { firstName, isDiscoverable });
    await testDb.db.photographer.create({
      data: { companyName: `${firstName} Co`, location: "Austin, TX", name: firstName, userId: user.id },
    });
    return user;
  }

  beforeAll(async () => {
    testDb = await createTestDb();
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
    await raw.messageThread.deleteMany();
    await raw.photographer.deleteMany();
    await raw.user.deleteMany();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    alice = await createDiscoverableUser("Alice");
    bob = await createDiscoverableUser("Bob");
  });

  it("requires a session", async () => {
    await expect(
      createDbCaller(discoverRouter, testDb.db).swipe({ direction: "like", targetId: bob.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("records a one-sided like without a match", async () => {
    const result = await as(alice).swipe({ direction: "like", targetId: bob.id });

    expect(result).toEqual({ matched: false, matchId: null, threadId: null });
    await expect(testDb.db.match.count()).resolves.toBe(0);
  });

  it("creates one match, one thread and one notification each on a mutual like", async () => {
    await as(alice).swipe({ direction: "like", targetId: bob.id });
    const result = await as(bob).swipe({ direction: "like", targetId: alice.id });

    expect(result.matched).toBe(true);
    const matches = await testDb.db.match.findMany();
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ id: result.matchId, messageThreadId: result.threadId });
    // Canonical ordering of the pair.
    expect([matches[0]?.user1Id, matches[0]?.user2Id]).toEqual([alice.id, bob.id].sort());

    const threads = await testDb.db.messageThread.findMany({ include: { participants: true } });
    expect(threads).toHaveLength(1);
    expect(threads[0]?.participantKey).toBe(threadParticipantKey([alice.id, bob.id]));
    expect(threads[0]?.participants.map((p) => p.id).sort()).toEqual([alice.id, bob.id].sort());

    const notified = (await testDb.db.notification.findMany()).map((n) => n.recipientId).sort();
    expect(notified).toEqual([alice.id, bob.id].sort());
  });

  it("creates exactly one match when both like each other at the same moment", async () => {
    for (let round = 0; round < 5; round++) {
      await testDb.raw.notification.deleteMany();
      await testDb.raw.match.deleteMany();
      await testDb.raw.swipe.deleteMany();
      await testDb.raw.messageThread.deleteMany();

      const results = await Promise.all([
        as(alice).swipe({ direction: "like", targetId: bob.id }),
        as(bob).swipe({ direction: "like", targetId: alice.id }),
      ]);

      // Neither request fails, and at least one of them reports the match.
      expect(results.some((result) => result.matched)).toBe(true);
      const matches = await testDb.db.match.findMany();
      expect(matches).toHaveLength(1);
      for (const result of results.filter((r) => r.matched)) {
        expect(result.matchId).toBe(matches[0]?.id);
      }
      await expect(testDb.db.messageThread.count()).resolves.toBe(1);
      await expect(testDb.db.notification.count()).resolves.toBe(2);
    }
  });

  it("returns the existing match when a like is repeated", async () => {
    await as(alice).swipe({ direction: "like", targetId: bob.id });
    const first = await as(bob).swipe({ direction: "like", targetId: alice.id });
    const again = await as(alice).swipe({ direction: "like", targetId: bob.id });

    expect(again).toEqual({ matched: true, matchId: first.matchId, threadId: first.threadId });
    await expect(testDb.db.match.count()).resolves.toBe(1);
    await expect(testDb.db.notification.count()).resolves.toBe(2);
    await expect(testDb.db.swipe.count()).resolves.toBe(2);
  });

  it("survives the same swipe submitted twice at once", async () => {
    const results = await Promise.all([
      as(alice).swipe({ direction: "like", targetId: bob.id }),
      as(alice).swipe({ direction: "like", targetId: bob.id }),
    ]);

    expect(results.every((result) => !result.matched)).toBe(true);
    await expect(testDb.db.swipe.count()).resolves.toBe(1);
  });

  it("lets a pass be changed to a like", async () => {
    await as(alice).swipe({ direction: "pass", targetId: bob.id });
    await as(alice).swipe({ direction: "like", targetId: bob.id });

    expect(await testDb.db.swipe.findMany()).toMatchObject([{ direction: "like" }]);
  });

  it("rejects swiping on yourself", async () => {
    await expect(
      as(alice).swipe({ direction: "like", targetId: alice.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a target that does not exist or is not discoverable, identically", async () => {
    const hidden = await createDiscoverableUser("Hidden", false);

    const missing = await as(alice)
      .swipe({ direction: "like", targetId: "no-such-user" })
      .catch((e: unknown) => e);
    const notDiscoverable = await as(alice)
      .swipe({ direction: "like", targetId: hidden.id })
      .catch((e: unknown) => e);

    expect(missing).toMatchObject({ code: "NOT_FOUND" });
    expect(notDiscoverable).toMatchObject({ code: "NOT_FOUND" });
    expect((missing as Error).message).toBe((notDiscoverable as Error).message);
    await expect(testDb.db.swipe.count()).resolves.toBe(0);
  });

  it("is rate limited per user", async () => {
    const limit = RateLimits.SWIPE.limit;
    for (let i = 0; i < limit; i++) {
      await as(alice).swipe({ direction: "pass", targetId: bob.id });
    }
    await expect(
      as(alice).swipe({ direction: "pass", targetId: bob.id }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
