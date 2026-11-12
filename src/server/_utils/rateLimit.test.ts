import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, type TestDb } from "~/test/helpers/sqlite";

import {
  checkRateLimit,
  checkRateLimitsInOrder,
  consumeRateLimit,
  enforceRateLimit,
  purgeExpiredRateLimits,
  RateLimits,
  type RateLimitDb,
  type RateLimitPolicy,
} from "./rateLimit";

const policy: RateLimitPolicy = {
  limit: 3,
  name: "test",
  onError: "deny",
  windowSeconds: 60,
};

// A fixed instant at the start of a 60-second window.
const T0 = 1_800_000_040_000 - (1_800_000_040_000 % 60_000);

const brokenDb: RateLimitDb = {
  $executeRaw: () => {
    throw new Error("database unavailable");
  },
  $queryRaw: () => {
    throw new Error("database unavailable");
  },
};

// Limiter windows are slices of wall-clock time; see freezeRateLimitClock.
const limiterClock = freezeRateLimitClock();

describe("rate limiter against SQLite", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.raw.rateLimit.deleteMany();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("allows requests up to the limit and reports what is left", async () => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await consumeRateLimit(testDb.db, policy, "user:1", { nowMs: T0 }));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0]);
    expect(results.every((r) => r.retryAfter === 0)).toBe(true);
  });

  it("denies the request after the limit, with the time until the window ends", async () => {
    for (let i = 0; i < 3; i++) {
      await consumeRateLimit(testDb.db, policy, "user:1", { nowMs: T0 });
    }
    const denied = await consumeRateLimit(testDb.db, policy, "user:1", { nowMs: T0 + 15_000 });
    expect(denied).toEqual({ allowed: false, remaining: 0, retryAfter: 45 });
  });

  it("starts a fresh count in the next window", async () => {
    for (let i = 0; i < 4; i++) {
      await consumeRateLimit(testDb.db, policy, "user:1", { nowMs: T0 });
    }
    const next = await consumeRateLimit(testDb.db, policy, "user:1", { nowMs: T0 + 60_000 });
    expect(next).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("counts identifiers and policies separately", async () => {
    for (let i = 0; i < 4; i++) {
      await consumeRateLimit(testDb.db, policy, "user:1", { nowMs: T0 });
    }
    const otherUser = await consumeRateLimit(testDb.db, policy, "user:2", { nowMs: T0 });
    const otherPolicy = await consumeRateLimit(
      testDb.db,
      { ...policy, name: "other" },
      "user:1",
      { nowMs: T0 },
    );
    expect(otherUser.allowed).toBe(true);
    expect(otherPolicy.allowed).toBe(true);
  });

  it("admits exactly `limit` of many concurrent requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        consumeRateLimit(testDb.db, policy, "user:burst", { nowMs: T0 }),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(policy.limit);

    const rows = await testDb.raw.rateLimit.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(25);
  });

  it("stores a keyed hash, never the identifier itself", async () => {
    await consumeRateLimit(testDb.db, policy, "email:someone@example.com", { nowMs: T0 });
    await consumeRateLimit(testDb.db, policy, "ip:203.0.113.9", { nowMs: T0 });

    const keys = (await testDb.raw.rateLimit.findMany()).map((row) => row.key);
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(/^test:[0-9a-f]{32}$/);
      expect(key).not.toContain("someone");
      expect(key).not.toContain("203.0.113.9");
    }
  });

  it("purges only counters whose window has ended", async () => {
    await consumeRateLimit(testDb.db, policy, "user:old", { nowMs: T0 });
    await consumeRateLimit(testDb.db, policy, "user:new", { nowMs: T0 + 120_000 });

    const removed = await purgeExpiredRateLimits(testDb.db, T0 + 120_000);

    expect(removed).toBe(1);
    await expect(testDb.raw.rateLimit.count()).resolves.toBe(1);
  });

  it("sweeps expired counters opportunistically when a window opens", async () => {
    await consumeRateLimit(testDb.db, policy, "user:old", { nowMs: T0, random: () => 1 });
    await expect(testDb.raw.rateLimit.count()).resolves.toBe(1);

    // random() below the cleanup probability triggers the sweep.
    await consumeRateLimit(testDb.db, policy, "user:new", { nowMs: T0 + 600_000, random: () => 0 });

    const rows = await testDb.raw.rateLimit.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.windowStart).toBe((T0 + 600_000) / 1000);
  });

  it("enforceRateLimit throws TOO_MANY_REQUESTS once over the limit", async () => {
    for (let i = 0; i < policy.limit; i++) {
      await enforceRateLimit(testDb.db, policy, "user:1");
    }
    const error = await enforceRateLimit(testDb.db, policy, "user:1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("says how long to wait in words", async () => {
    const waitAfter = async (windowSeconds: number, elapsedSeconds: number) => {
      const timed: RateLimitPolicy = { ...policy, limit: 1, name: `wait-${windowSeconds}-${elapsedSeconds}`, windowSeconds };
      await enforceRateLimit(testDb.db, timed, "user:1");
      limiterClock.advance(elapsedSeconds);
      const error = await enforceRateLimit(testDb.db, timed, "user:1").catch((e: unknown) => e);
      limiterClock.advance(-elapsedSeconds);
      return (error as Error).message;
    };

    await expect(waitAfter(60, 15)).resolves.toBe("Too many requests. Try again in 45 seconds.");
    await expect(waitAfter(60, 59)).resolves.toBe("Too many requests. Try again in 1 second.");
    await expect(waitAfter(900, 10)).resolves.toBe("Too many requests. Try again in 15 minutes.");
    await expect(waitAfter(3600, 3540)).resolves.toBe("Too many requests. Try again in 1 minute.");
    await expect(waitAfter(86_400, 3600)).resolves.toBe("Too many requests. Try again in 23 hours.");
  });

  it("checks limits in order and does not count the ones after a refusal", async () => {
    const first: RateLimitPolicy = { ...policy, limit: 1, name: "first" };
    const second: RateLimitPolicy = { ...policy, limit: 5, name: "second" };
    const checks = [
      { identifier: "ip:203.0.113.9", policy: first },
      { identifier: "email:someone@example.com", policy: second },
    ];

    await expect(checkRateLimitsInOrder(testDb.db, checks)).resolves.toBeNull();
    for (let i = 0; i < 10; i++) {
      await expect(checkRateLimitsInOrder(testDb.db, checks)).resolves.toMatchObject({
        allowed: false,
        policy: { name: "first" },
      });
    }

    const rows = await testDb.raw.rateLimit.findMany({ orderBy: { count: "asc" } });
    // The second limit was counted once, by the request that passed the first.
    expect(rows.map((row) => [row.key.split(":")[0], row.count])).toEqual([
      ["second", 1],
      ["first", 11],
    ]);
  });

  it("fails closed in an ordered check when the limiter is down", async () => {
    await expect(
      checkRateLimitsInOrder(brokenDb, [{ identifier: "user:1", policy }]),
    ).resolves.toMatchObject({ allowed: false, limiterFailed: true });
  });
});

describe("limiter failure", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("fails closed for a deny policy", async () => {
    const result = await checkRateLimit(brokenDb, policy, "user:1");
    expect(result).toMatchObject({ allowed: false, limiterFailed: true });

    await expect(enforceRateLimit(brokenDb, policy, "user:1")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("fails open for an allow policy", async () => {
    const lenient: RateLimitPolicy = { ...policy, onError: "allow" };
    const result = await checkRateLimit(brokenDb, lenient, "user:1");
    expect(result).toMatchObject({ allowed: true, limiterFailed: true });

    await expect(enforceRateLimit(brokenDb, lenient, "user:1")).resolves.toBeUndefined();
  });

  it("does not put the identifier in the error log", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await checkRateLimit(brokenDb, policy, "email:someone@example.com");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("someone@example.com");
  });
});

describe("RateLimits", () => {
  it("fails closed for every sign-in, invite and waitlist policy", () => {
    const authSensitive = [
      RateLimits.OTP_REQUEST_EMAIL,
      RateLimits.OTP_REQUEST_IP,
      RateLimits.OTP_VERIFY_EMAIL,
      RateLimits.OTP_VERIFY_IP,
      RateLimits.OTP_REQUEST_EMAIL_DAILY,
      RateLimits.OTP_VERIFY_EMAIL_DAILY,
      RateLimits.MOBILE_TOKEN_EXCHANGE,
      RateLimits.INVITE_VALIDATE,
      RateLimits.INVITE_PREPARE,
      RateLimits.WAITLIST_SUBMIT,
    ];
    expect(authSensitive.every((p) => p.onError === "deny")).toBe(true);
  });

  it("gives every policy a distinct bucket name", () => {
    const names = Object.values(RateLimits).map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
