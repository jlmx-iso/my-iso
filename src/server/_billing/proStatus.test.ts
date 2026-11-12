import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import { entitlementsFor, PAST_DUE_GRACE_DAYS, type SubscriptionSnapshot } from "./entitlements";
import { proAccessSql, proUserIds, storedTimestamp, withPro, withProOn } from "./proStatus";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2030-06-15T12:00:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

const LEGACY = {
  isActive: false,
  isCanceled: false,
  isExpired: false,
  isPaused: false,
  isPending: false,
  isTrial: false,
};

function snapshot(overrides: Partial<SubscriptionSnapshot>): SubscriptionSnapshot {
  return {
    cancelAt: null,
    cancelAtPeriodEnd: false,
    cancellationReason: null,
    disputeStatus: null,
    isLifetime: false,
    latestInvoiceId: "in_current",
    paidThroughAt: at(20),
    pastDueSince: null,
    refundedInvoiceId: null,
    status: "active",
    ...overrides,
  };
}

/**
 * Every case the rule distinguishes, and the edges around each time limit.
 * The SQL mirror and entitlementsFor must agree on all of them at every
 * moment in MOMENTS.
 */
const CASES: Record<string, SubscriptionSnapshot> = {
  active: snapshot({}),
  activeEndingLater: snapshot({ cancelAt: at(5), cancelAtPeriodEnd: true }),
  activeEndedAlready: snapshot({ cancelAt: at(-1), cancelAtPeriodEnd: true }),
  activeCancelAtWithoutPeriodEnd: snapshot({ cancelAt: at(-1), cancelAtPeriodEnd: false }),
  activeEndingNoDate: snapshot({ cancelAt: null, cancelAtPeriodEnd: true }),
  trialing: snapshot({ status: "trialing" }),
  trialingEnded: snapshot({ cancelAt: at(-3), cancelAtPeriodEnd: true, status: "trialing" }),
  pastDueFresh: snapshot({ pastDueSince: at(-2), status: "past_due" }),
  pastDueAtGraceEdge: snapshot({ pastDueSince: at(-PAST_DUE_GRACE_DAYS), status: "past_due" }),
  pastDueExpired: snapshot({ pastDueSince: at(-PAST_DUE_GRACE_DAYS - 1), status: "past_due" }),
  pastDueNoAnchor: snapshot({ pastDueSince: null, status: "past_due" }),
  canceledRequestedPaid: snapshot({ cancellationReason: "cancellation_requested", status: "canceled" }),
  canceledRequestedPaidEnded: snapshot({
    cancellationReason: "cancellation_requested",
    paidThroughAt: at(-1),
    status: "canceled",
  }),
  canceledRequestedUnpaid: snapshot({ cancellationReason: "cancellation_requested", paidThroughAt: null, status: "canceled" }),
  canceledRequestedRefunded: snapshot({
    cancellationReason: "cancellation_requested",
    refundedInvoiceId: "in_current",
    status: "canceled",
  }),
  canceledRequestedOlderRefund: snapshot({
    cancellationReason: "cancellation_requested",
    refundedInvoiceId: "in_older",
    status: "canceled",
  }),
  canceledRequestedNoInvoiceRefund: snapshot({
    cancellationReason: "cancellation_requested",
    latestInvoiceId: null,
    refundedInvoiceId: "in_any",
    status: "canceled",
  }),
  canceledForNonPayment: snapshot({ cancellationReason: "payment_failed", status: "canceled" }),
  canceledNoReason: snapshot({ status: "canceled" }),
  disputedOpen: snapshot({ disputeStatus: "open" }),
  disputedLost: snapshot({ disputeStatus: "lost", pastDueSince: at(-1), status: "past_due" }),
  disputeOtherValue: snapshot({ disputeStatus: "won" }),
  lifetime: snapshot({ isLifetime: true, status: "canceled" }),
  lifetimeDisputed: snapshot({ disputeStatus: "open", isLifetime: true }),
  unpaid: snapshot({ status: "unpaid" }),
  incomplete: snapshot({ status: "incomplete" }),
  incompleteExpired: snapshot({ status: "incomplete_expired" }),
  paused: snapshot({ status: "paused" }),
  unknownStatus: snapshot({ status: "something_new" }),
};

/** Before, at and after each limit in CASES, by a millisecond where it matters. */
const MOMENTS = [
  NOW,
  new Date(NOW.getTime() - 1),
  at(-1),
  new Date(at(-1).getTime() + 1),
  at(4.99),
  at(5),
  at(5.01),
  at(19.99),
  at(20),
  at(21),
  at(30),
  at(-30),
];

describe("proAccessSql mirrors entitlementsFor", () => {
  let testDb: TestDb;
  const userIdByCase = new Map<string, string>();
  let noRowUserId: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    for (const [name, row] of Object.entries(CASES)) {
      const user = await createTestUser(testDb.db);
      userIdByCase.set(name, user.id);
      await testDb.db.subscription.create({ data: { ...LEGACY, ...row, userId: user.id } });
    }
    noRowUserId = (await createTestUser(testDb.db)).id;
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function sqlProIds(now: Date): Promise<Set<string>> {
    const rows = await testDb.db.$queryRaw<Array<{ id: string; isPro: number | bigint }>>(Prisma.sql`
      SELECT u."id" AS "id", CASE WHEN ${proAccessSql("s", now)} THEN 1 ELSE 0 END AS "isPro"
      FROM "User" u LEFT JOIN "Subscription" s ON s."userId" = u."id"`);
    return new Set(rows.filter((row) => Number(row.isPro) === 1).map((row) => row.id));
  }

  it.each(MOMENTS.map((moment) => [moment.toISOString(), moment] as const))(
    "agrees on every case at %s",
    async (_label, moment) => {
      const fromSql = await sqlProIds(moment);
      for (const [name, row] of Object.entries(CASES)) {
        const userId = userIdByCase.get(name) ?? "";
        expect(fromSql.has(userId), `${name} at ${moment.toISOString()}`).toBe(
          entitlementsFor(row, moment).hasProAccess,
        );
      }
      expect(fromSql.has(noRowUserId)).toBe(false);
    },
  );

  it("covers both answers (the cases are not all Pro or all free)", async () => {
    const fromSql = await sqlProIds(NOW);
    expect(fromSql.size).toBeGreaterThan(3);
    expect(fromSql.size).toBeLessThan(Object.keys(CASES).length);
  });

  it("proUserIds gives the same answer as the SQL, from one query per batch", async () => {
    const ids = [...userIdByCase.values(), noRowUserId];
    const findMany = vi.spyOn(testDb.db.subscription, "findMany");
    try {
      const fromTs = await proUserIds(testDb.db, ids, NOW);
      expect(fromTs).toEqual(await sqlProIds(NOW));
      expect(findMany).toHaveBeenCalledTimes(1);
    } finally {
      findMany.mockRestore();
    }
  });

  it("a lapse takes effect at the moment access ends, with nothing written", async () => {
    const endingId = userIdByCase.get("activeEndingLater") ?? "";
    expect((await proUserIds(testDb.db, [endingId], at(4.99))).has(endingId)).toBe(true);
    expect((await sqlProIds(at(4.99))).has(endingId)).toBe(true);
    expect((await proUserIds(testDb.db, [endingId], at(5))).has(endingId)).toBe(false);
    expect((await sqlProIds(at(5))).has(endingId)).toBe(false);
  });
});

describe("proUserIds", () => {
  it("asks nothing for no ids, and batches beyond 90 ids", async () => {
    const findMany = vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
      where.userId.in.filter((id) => id.endsWith("7")).map((userId) => ({ ...snapshot({}), userId })),
    );
    const db = { subscription: { findMany } };

    expect(await proUserIds(db, [], NOW)).toEqual(new Set());
    expect(findMany).not.toHaveBeenCalled();

    const ids = Array.from({ length: 200 }, (_, index) => `user${index}`);
    const pro = await proUserIds(db, [...ids, ...ids], NOW);
    expect(findMany).toHaveBeenCalledTimes(3);
    for (const call of findMany.mock.calls) expect(call[0].where.userId.in.length).toBeLessThanOrEqual(90);
    expect(pro).toEqual(new Set(ids.filter((id) => id.endsWith("7"))));
  });

  it("withPro and withProOn add the flag to each item, in one lookup", async () => {
    const findMany = vi.fn(async () => [{ ...snapshot({}), userId: "u1" }]);
    const db = { subscription: { findMany } };

    expect(await withPro(db, [{ id: "u1" }, { id: "u2" }], (item) => item.id, NOW)).toEqual([
      { id: "u1", isPro: true },
      { id: "u2", isPro: false },
    ]);
    const events = [
      { id: "e1", photographer: { name: "A", userId: "u2" } },
      { id: "e2", photographer: { name: "B", userId: "u1" } },
    ];
    expect(await withProOn(db, events, "photographer", (person) => person.userId, NOW)).toEqual([
      { id: "e1", photographer: { isPro: false, name: "A", userId: "u2" } },
      { id: "e2", photographer: { isPro: true, name: "B", userId: "u1" } },
    ]);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});

describe("storedTimestamp", () => {
  it("spells a time as Prisma stores it", () => {
    expect(storedTimestamp(new Date("2030-01-02T03:04:05.006Z"))).toBe("2030-01-02T03:04:05.006+00:00");
  });
});
