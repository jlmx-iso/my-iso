import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/helpers/sqlite";

import { claimFor, extendClaim, LeaseBusyError, withLease } from "./lease";

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

const OPTIONS = { ttlSeconds: 30, waitMs: 5000 };

describe("withLease", () => {
  it("runs the work of concurrent callers one at a time", async () => {
    let running = 0;
    let mostAtOnce = 0;
    const work = async () => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
    };

    await Promise.all(Array.from({ length: 5 }, () => withLease(testDb.db, "k", OPTIONS, work)));

    expect(mostAtOnce).toBe(1);
    expect(await testDb.raw.billingLease.count()).toBe(0);
  });

  it("releases the lease when the work throws", async () => {
    await expect(
      withLease(testDb.db, "k", OPTIONS, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await testDb.raw.billingLease.count()).toBe(0);
    expect(await withLease(testDb.db, "k", OPTIONS, async () => "next")).toBe("next");
  });

  it("does not block other keys", async () => {
    const result = await withLease(testDb.db, "a", OPTIONS, () => withLease(testDb.db, "b", OPTIONS, async () => "both"));

    expect(result).toBe("both");
  });

  it("waits no longer than waitMs, and takes over once the holder's lease has expired", async () => {
    let clock = 1_900_000_000_000;
    const timing = { now: () => clock, sleep: async (ms: number) => void (clock += ms) };
    await testDb.raw.billingLease.create({ data: { expiresAt: clock / 1000 + 30, holder: "other", key: "k" } });

    await expect(withLease(testDb.db, "k", { ...OPTIONS, ...timing }, async () => "ran")).rejects.toBeInstanceOf(LeaseBusyError);
    expect(clock - 1_900_000_000_000).toBeGreaterThanOrEqual(5000);
    expect(clock - 1_900_000_000_000).toBeLessThan(5400);

    // 30 seconds after it was taken, the dead holder's lease can be taken over.
    clock = 1_900_000_000_000 + 30_000;
    expect(await withLease(testDb.db, "k", { ...OPTIONS, ...timing }, async () => "ran")).toBe("ran");
  });

  it("releasing never removes a lease that someone else has taken over", async () => {
    let clock = 1_900_000_000_000;
    const timing = { now: () => clock };

    await withLease(testDb.db, "k", { ...OPTIONS, ...timing }, async () => {
      // This holder overruns its lease; another request takes it over.
      clock += 31_000;
      await withLease(testDb.db, "k", { ...OPTIONS, ...timing }, async () => {
        expect(await testDb.raw.billingLease.count()).toBe(1);
      });
      await testDb.raw.billingLease.create({ data: { expiresAt: clock / 1000 + 30, holder: "third", key: "k" } });
    });

    expect(await testDb.raw.billingLease.findUnique({ where: { key: "k" } })).toMatchObject({ holder: "third" });
  });

  it("renew extends the lease while it is held, and fails once another request has taken it over", async () => {
    let clock = 1_900_000_000_000;
    const timing = { now: () => clock };

    await withLease(testDb.db, "k", { ...OPTIONS, ...timing }, async (lease) => {
      clock += 20_000;
      expect(await lease.renew()).toBe(true);
      expect((await testDb.raw.billingLease.findUniqueOrThrow({ where: { key: "k" } })).expiresAt).toBe(clock / 1000 + 30);

      // Renewed, so 20 more seconds do not let anyone in...
      clock += 20_000;
      await expect(
        withLease(testDb.db, "k", { ...timing, sleep: async (ms) => void (clock += ms), ttlSeconds: 30, waitMs: 300 }, async () => "ran"),
      ).rejects.toBeInstanceOf(LeaseBusyError);

      // ...but overrunning the renewed lease does, and then it is lost.
      clock += 31_000;
      await withLease(testDb.db, "k", { ...OPTIONS, ...timing }, async (other) => {
        expect(await lease.renew()).toBe(false);
        expect(await other.renew()).toBe(true);
      });
      expect(await lease.renew()).toBe(false);
    });
  });

  it("heldCondition makes a write depend on still holding the lease, in the same statement", async () => {
    let clock = 1_900_000_000_000;
    const timing = { now: () => clock };
    await testDb.raw.billingLease.create({ data: { expiresAt: 0, holder: "x", key: "target" } });
    const write = (condition: ReturnType<Parameters<Parameters<typeof withLease>[3]>[0]["heldCondition"]>) =>
      testDb.db.$executeRaw`UPDATE "BillingLease" SET "expiresAt" = "expiresAt" + 1 WHERE "key" = 'target' AND ${condition}`;

    await withLease(testDb.db, "k", { ...OPTIONS, ...timing }, async (lease) => {
      expect(await write(lease.heldCondition())).toBe(1);
      clock += 31_000;
      await withLease(testDb.db, "k", { ...OPTIONS, ...timing }, async () => {
        expect(await write(lease.heldCondition())).toBe(0);
      });
    });
  });
});

describe("claimFor", () => {
  it("is granted once per period, across callers, and can be extended", async () => {
    const t0 = 1_900_000_000_000;

    expect(await claimFor(testDb.db, "first-sync:row", 600, t0)).toBe(true);
    expect(await claimFor(testDb.db, "first-sync:row", 600, t0 + 599_000)).toBe(false);
    expect(await claimFor(testDb.db, "first-sync:row", 600, t0 + 600_000)).toBe(true);

    await extendClaim(testDb.db, "first-sync:row", 86_400, t0 + 600_000);
    expect(await claimFor(testDb.db, "first-sync:row", 600, t0 + 3_600_000)).toBe(false);
    expect(await claimFor(testDb.db, "first-sync:row", 600, t0 + 600_000 + 86_400_000)).toBe(true);
  });
});
