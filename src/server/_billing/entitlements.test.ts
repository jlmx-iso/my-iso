import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import {
  entitlementsFor,
  getEntitlements,
  hasProAccess,
  isTerminalStatus,
  PAST_DUE_GRACE_DAYS,
  SUBSCRIPTION_STATUSES,
  type SubscriptionSnapshot,
} from "./entitlements";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2030-06-15T12:00:00Z");
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

function snapshot(overrides: Partial<SubscriptionSnapshot>): SubscriptionSnapshot {
  return {
    cancelAt: null,
    cancelAtPeriodEnd: false,
    cancellationReason: null,
    currentPeriodEnd: daysFromNow(20),
    currentPeriodStart: daysFromNow(-10),
    interval: "month",
    isLifetime: false,
    plan: "standard",
    status: "active",
    ...overrides,
  };
}

describe("entitlementsFor", () => {
  it("gives no access without a subscription", () => {
    expect(entitlementsFor(null, NOW)).toEqual({
      accessEndsAt: null,
      hasProAccess: false,
      isPastDue: false,
      reason: "none",
    });
  });

  it.each(["active", "trialing"])("grants access for %s, open-ended while it renews", (status) => {
    expect(entitlementsFor(snapshot({ status }), NOW)).toEqual({
      accessEndsAt: null,
      hasProAccess: true,
      isPastDue: false,
      reason: status,
    });
  });

  it("reports when access ends for a subscription set to cancel", () => {
    const result = entitlementsFor(
      snapshot({ cancelAt: daysFromNow(20), cancelAtPeriodEnd: true }),
      NOW,
    );

    expect(result).toMatchObject({ accessEndsAt: daysFromNow(20), hasProAccess: true, reason: "active" });
  });

  it("keeps access for past_due inside the retry window", () => {
    const result = entitlementsFor(
      snapshot({ currentPeriodStart: daysFromNow(-3), status: "past_due" }),
      NOW,
    );

    expect(result).toEqual({
      accessEndsAt: daysFromNow(PAST_DUE_GRACE_DAYS - 3),
      hasProAccess: true,
      isPastDue: true,
      reason: "past_due_grace",
    });
  });

  it("ends access for past_due once the retry window has passed", () => {
    const result = entitlementsFor(
      snapshot({ currentPeriodStart: daysFromNow(-(PAST_DUE_GRACE_DAYS + 1)), status: "past_due" }),
      NOW,
    );

    expect(result).toMatchObject({ hasProAccess: false, isPastDue: true, reason: "none" });
  });

  it("keeps access for past_due when the period start is unknown (Stripe is still retrying)", () => {
    const result = entitlementsFor(snapshot({ currentPeriodStart: null, status: "past_due" }), NOW);

    expect(result).toMatchObject({ accessEndsAt: null, hasProAccess: true, isPastDue: true });
  });

  it("keeps access for a requested cancellation until the paid period ends", () => {
    const canceled = snapshot({
      cancellationReason: "cancellation_requested",
      currentPeriodEnd: daysFromNow(5),
      status: "canceled",
    });

    expect(entitlementsFor(canceled, NOW)).toEqual({
      accessEndsAt: daysFromNow(5),
      hasProAccess: true,
      isPastDue: false,
      reason: "canceled_paid_period",
    });
    expect(entitlementsFor(canceled, daysFromNow(5)).hasProAccess).toBe(false);
    expect(entitlementsFor(canceled, daysFromNow(6)).hasProAccess).toBe(false);
  });

  it.each(["payment_failed", "payment_disputed", "canceled_by_retention_policy", null])(
    "gives no access for a subscription cancelled for %s, even with period left",
    (cancellationReason) => {
      const result = entitlementsFor(
        snapshot({ cancellationReason, currentPeriodEnd: daysFromNow(20), status: "canceled" }),
        NOW,
      );

      expect(result.hasProAccess).toBe(false);
    },
  );

  it.each(["unpaid", "incomplete", "incomplete_expired", "paused", "some_future_status"])(
    "gives no access for %s",
    (status) => {
      expect(entitlementsFor(snapshot({ status }), NOW).hasProAccess).toBe(false);
    },
  );

  it("flags unpaid as a payment problem", () => {
    expect(entitlementsFor(snapshot({ status: "unpaid" }), NOW).isPastDue).toBe(true);
  });

  it("always grants access to a lifetime account", () => {
    const result = entitlementsFor(snapshot({ isLifetime: true, status: "canceled" }), NOW);

    expect(result).toEqual({ accessEndsAt: null, hasProAccess: true, isPastDue: false, reason: "lifetime" });
  });

  it("covers every Stripe status", () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      expect(typeof entitlementsFor(snapshot({ status }), NOW).hasProAccess).toBe("boolean");
    }
    expect(SUBSCRIPTION_STATUSES.filter(isTerminalStatus)).toEqual(["canceled", "incomplete_expired"]);
  });
});

describe("getEntitlements / hasProAccess (real database)", () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await testDb.close();
  });

  const legacy = {
    isActive: false,
    isCanceled: false,
    isExpired: false,
    isLifetime: false,
    isPaused: false,
    isPending: false,
    isTrial: false,
  };

  it("is false for a user without a subscription row", async () => {
    const user = await createTestUser(testDb.db);

    expect(await hasProAccess(testDb.db, user.id)).toBe(false);
    expect((await getEntitlements(testDb.db, user.id)).reason).toBe("none");
  });

  it("derives access from the stored status and period, not from the legacy flags", async () => {
    const user = await createTestUser(testDb.db);
    await testDb.db.subscription.create({
      data: {
        ...legacy,
        // A stale legacy flag must not grant anything.
        isActive: true,
        currentPeriodEnd: daysFromNow(-1),
        status: "canceled",
        userId: user.id,
      },
    });

    expect(await hasProAccess(testDb.db, user.id, NOW)).toBe(false);

    await testDb.db.subscription.update({
      data: { currentPeriodEnd: daysFromNow(30), isActive: false, status: "active" },
      where: { userId: user.id },
    });

    expect(await hasProAccess(testDb.db, user.id, NOW)).toBe(true);
  });
});
