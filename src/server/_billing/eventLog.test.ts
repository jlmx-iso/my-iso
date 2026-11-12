import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "~/test/helpers/sqlite";

import {
  CLAIM_LEASE_SECONDS,
  claimStripeEvent,
  completeStripeEvent,
  purgeOldStripeEvents,
  releaseStripeEvent,
} from "./eventLog";

const NOW_MS = Date.UTC(2030, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT = { created: 1_890_000_000, id: "evt_1", type: "customer.subscription.updated" };
// Never purges: the claim's 1% cleanup is decided by this.
const noCleanup = () => 0.99;

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

const ids = async () =>
  (await testDb.db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "StripeEvent" ORDER BY "id"`).map(
    (row) => row.id,
  );

describe("Stripe event log", () => {
  it("lets one delivery claim an event; the others wait, then see it handled", async () => {
    const claim = await claimStripeEvent(testDb.db, EVENT, { nowMs: NOW_MS, random: noCleanup });
    expect(claim).toEqual({ claimedAt: NOW_MS / 1000, status: "claimed" });

    await expect(claimStripeEvent(testDb.db, EVENT, { nowMs: NOW_MS, random: noCleanup })).resolves.toEqual({
      status: "in_progress",
    });

    if (claim.status !== "claimed") throw new Error("expected a claim");
    await completeStripeEvent(testDb.db, EVENT.id, claim.claimedAt, NOW_MS);
    await expect(claimStripeEvent(testDb.db, EVENT, { nowMs: NOW_MS + DAY_MS, random: noCleanup })).resolves.toEqual({
      status: "duplicate",
    });
  });

  it("frees a released claim for the retry", async () => {
    const claim = await claimStripeEvent(testDb.db, EVENT, { nowMs: NOW_MS, random: noCleanup });
    if (claim.status !== "claimed") throw new Error("expected a claim");

    await releaseStripeEvent(testDb.db, EVENT.id, claim.claimedAt);
    expect(await ids()).toEqual([]);
    await expect(claimStripeEvent(testDb.db, EVENT, { nowMs: NOW_MS, random: noCleanup })).resolves.toMatchObject({
      status: "claimed",
    });
  });

  it("lets a redelivery take over a claim whose lease ran out, and ignores the first holder's late complete", async () => {
    const first = await claimStripeEvent(testDb.db, EVENT, { nowMs: NOW_MS, random: noCleanup });
    const laterMs = NOW_MS + (CLAIM_LEASE_SECONDS + 1) * 1000;
    const second = await claimStripeEvent(testDb.db, EVENT, { nowMs: laterMs, random: noCleanup });
    expect(second).toEqual({ claimedAt: laterMs / 1000, status: "claimed" });

    if (first.status !== "claimed") throw new Error("expected a claim");
    await completeStripeEvent(testDb.db, EVENT.id, first.claimedAt, laterMs);
    // Still the second holder's claim, not processed.
    await expect(claimStripeEvent(testDb.db, EVENT, { nowMs: laterMs, random: noCleanup })).resolves.toEqual({
      status: "in_progress",
    });

    // The first holder giving up late does not delete the second one's claim.
    await releaseStripeEvent(testDb.db, EVENT.id, first.claimedAt);
    expect(await ids()).toEqual([EVENT.id]);
    await expect(claimStripeEvent(testDb.db, EVENT, { nowMs: laterMs, random: noCleanup })).resolves.toEqual({
      status: "in_progress",
    });
  });

  it("purges ids past retention, now and then on a claim", async () => {
    await claimStripeEvent(testDb.db, { ...EVENT, id: "evt_old" }, { nowMs: NOW_MS - 31 * DAY_MS, random: noCleanup });
    await claimStripeEvent(testDb.db, { ...EVENT, id: "evt_recent" }, { nowMs: NOW_MS - DAY_MS, random: noCleanup });

    await claimStripeEvent(testDb.db, EVENT, { nowMs: NOW_MS, random: () => 0 });
    expect(await ids()).toEqual(["evt_1", "evt_recent"]);
    await expect(purgeOldStripeEvents(testDb.db, NOW_MS + 31 * DAY_MS)).resolves.toBe(2);
  });

  it("still claims when the purge fails", async () => {
    const db = {
      $executeRaw: vi.fn(async () => {
        throw new Error("D1 busy");
      }),
      $queryRaw: testDb.db.$queryRaw.bind(testDb.db),
    } as unknown as typeof testDb.db;

    await expect(claimStripeEvent(db, EVENT, { nowMs: NOW_MS, random: () => 0 })).resolves.toMatchObject({
      status: "claimed",
    });
    expect(db.$executeRaw).toHaveBeenCalled();
  });
});
