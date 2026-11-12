import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  generateIcebreakers: vi.fn(),
  generateMatchSummary: vi.fn(),
}));

vi.mock("./ai", async (importOriginal) => ({
  ...(await importOriginal<typeof Ai>()),
  generateIcebreakers: mocks.generateIcebreakers,
  generateMatchSummary: mocks.generateMatchSummary,
  isAiEnabled: () => mocks.enabled,
}));

import { createTestDb, type TestDb } from "~/test/helpers/sqlite";

import type * as Ai from "./ai";
import {
  AI_GENERATION_DAILY,
  ensureIcebreakers,
  ensureMatchSummary,
  generateMatchInsights,
  readIcebreakers,
  RETRY_AFTER_MS,
} from "./matchInsights";

const LINES = ["Loved your film work!", "Fellow Texan here.", "What gear do you bring?"];
const NOW = new Date("2026-11-12T12:00:00.000Z");

let testDb: TestDb;
let matchId: string;
let userId: string;
let userCount = 0;

async function createUser(firstName: string) {
  userCount += 1;
  return testDb.raw.user.create({
    data: { email: `insights${userCount}@example.com`, firstName, lastName: "Tester" },
  });
}

const match = () => testDb.raw.match.findUniqueOrThrow({ where: { id: matchId } });

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.generateIcebreakers.mockResolvedValue({ ok: true, value: LINES });
  mocks.generateMatchSummary.mockResolvedValue({ ok: true, value: "A good fit." });

  await testDb.raw.match.deleteMany();
  await testDb.raw.$executeRaw`DELETE FROM "RateLimit"`;
  await testDb.raw.user.deleteMany();

  const [a, b] = [await createUser("Sarah"), await createUser("Marcus")].sort((x, y) =>
    x.id < y.id ? -1 : 1,
  );
  userId = a!.id;
  matchId = (await testDb.raw.match.create({ data: { user1Id: a!.id, user2Id: b!.id } })).id;
});

describe("ensureIcebreakers", () => {
  it("generates once, stores the result, and never calls the model again", async () => {
    await expect(ensureIcebreakers(testDb.db, { matchId, now: NOW, requestedBy: userId })).resolves.toBe(
      "generated",
    );
    expect(JSON.parse((await match()).icebreakers ?? "null")).toEqual(LINES);
    expect(mocks.generateIcebreakers).toHaveBeenCalledOnce();
    expect(mocks.generateIcebreakers.mock.calls[0]?.[0]).toMatchObject({ firstName: "Sarah" });
    expect(mocks.generateIcebreakers.mock.calls[0]?.[1]).toMatchObject({ firstName: "Marcus" });

    // Later calls, however much later, find it stored.
    for (const later of [NOW, new Date(NOW.getTime() + 10 * RETRY_AFTER_MS)]) {
      await expect(
        ensureIcebreakers(testDb.db, { matchId, now: later, requestedBy: userId }),
      ).resolves.toBe("skipped");
    }
    expect(mocks.generateIcebreakers).toHaveBeenCalledOnce();
  });

  it("lets exactly one of many concurrent callers generate", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        ensureIcebreakers(testDb.db, { matchId, now: NOW, requestedBy: userId }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome === "generated")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "skipped")).toHaveLength(7);
    expect(mocks.generateIcebreakers).toHaveBeenCalledOnce();
  });

  it("after a failure, waits before trying again, then succeeds", async () => {
    mocks.generateIcebreakers.mockResolvedValueOnce({ ok: false, reason: "api_error" });

    await expect(ensureIcebreakers(testDb.db, { matchId, now: NOW, requestedBy: userId })).resolves.toBe(
      "api_error",
    );
    expect((await match()).icebreakers).toBeNull();

    // Opening the page again straight away does not hit the provider.
    const soon = new Date(NOW.getTime() + RETRY_AFTER_MS - 1000);
    await expect(ensureIcebreakers(testDb.db, { matchId, now: soon, requestedBy: userId })).resolves.toBe(
      "skipped",
    );
    expect(mocks.generateIcebreakers).toHaveBeenCalledOnce();

    const later = new Date(NOW.getTime() + RETRY_AFTER_MS + 1000);
    await expect(ensureIcebreakers(testDb.db, { matchId, now: later, requestedBy: userId })).resolves.toBe(
      "generated",
    );
    expect(mocks.generateIcebreakers).toHaveBeenCalledTimes(2);
  });

  it("stops at the member's daily cap", async () => {
    // Each iteration is a fresh match for the same member.
    let generated = 0;
    for (let i = 0; i < AI_GENERATION_DAILY.limit + 3; i++) {
      const other = await createUser(`Other${i}`);
      const [user1Id, user2Id] = [userId, other.id].sort();
      const fresh = await testDb.raw.match.create({ data: { user1Id: user1Id!, user2Id: user2Id! } });
      const outcome = await ensureIcebreakers(testDb.db, { matchId: fresh.id, requestedBy: userId });
      if (outcome === "generated") generated += 1;
      else expect(outcome).toBe("rate_limited");
    }
    expect(generated).toBe(AI_GENERATION_DAILY.limit);
    expect(mocks.generateIcebreakers).toHaveBeenCalledTimes(AI_GENERATION_DAILY.limit);
  });

  it("does nothing without an API key: no claim, no counter, no call", async () => {
    mocks.enabled = false;
    await expect(ensureIcebreakers(testDb.db, { matchId, now: NOW, requestedBy: userId })).resolves.toBe(
      "disabled",
    );
    expect((await match()).icebreakersRequestedAt).toBeNull();
    expect(await testDb.raw.$queryRaw<unknown[]>`SELECT 1 FROM "RateLimit"`).toHaveLength(0);
    expect(mocks.generateIcebreakers).not.toHaveBeenCalled();
  });

  it("treats a match that does not exist as nothing to do", async () => {
    await expect(
      ensureIcebreakers(testDb.db, { matchId: "missing", now: NOW, requestedBy: userId }),
    ).resolves.toBe("skipped");
  });
});

describe("ensureMatchSummary", () => {
  it("stores the summary once", async () => {
    await expect(ensureMatchSummary(testDb.db, { matchId, requestedBy: userId })).resolves.toBe("generated");
    expect((await match()).aiSummary).toBe("A good fit.");
    await expect(ensureMatchSummary(testDb.db, { matchId, requestedBy: userId })).resolves.toBe("skipped");
    expect(mocks.generateMatchSummary).toHaveBeenCalledOnce();
  });

  it("leaves the summary empty when generation fails", async () => {
    mocks.generateMatchSummary.mockResolvedValue({ ok: false, reason: "refusal" });
    await expect(ensureMatchSummary(testDb.db, { matchId, requestedBy: userId })).resolves.toBe("refusal");
    expect((await match()).aiSummary).toBeNull();
  });
});

describe("generateMatchInsights", () => {
  it("writes both; one failing does not stop the other", async () => {
    mocks.generateMatchSummary.mockResolvedValue({ ok: false, reason: "timeout" });
    await expect(generateMatchInsights(testDb.db, { matchId, requestedBy: userId })).resolves.toEqual({
      icebreakers: "generated",
      summary: "timeout",
    });
    const stored = await match();
    expect(stored.aiSummary).toBeNull();
    expect(JSON.parse(stored.icebreakers ?? "null")).toEqual(LINES);
  });
});

describe("readIcebreakers", () => {
  it("serves stored lines as ready", () => {
    expect(readIcebreakers(JSON.stringify(LINES))).toEqual({
      icebreakers: LINES,
      icebreakersStatus: "ready",
    });
  });

  it("says pending while there is nothing stored yet", () => {
    expect(readIcebreakers(null)).toEqual({ icebreakers: [], icebreakersStatus: "pending" });
  });

  it("says unavailable, not pending for ever, for a stored value that does not parse", () => {
    expect(readIcebreakers("corrupt")).toEqual({ icebreakers: [], icebreakersStatus: "unavailable" });
    expect(readIcebreakers("[]")).toEqual({ icebreakers: [], icebreakersStatus: "unavailable" });
  });

  it("says unavailable when AI is switched off", () => {
    mocks.enabled = false;
    expect(readIcebreakers(null)).toEqual({ icebreakers: [], icebreakersStatus: "unavailable" });
    // Lines stored earlier are still served.
    expect(readIcebreakers(JSON.stringify(LINES)).icebreakersStatus).toBe("ready");
  });
});
