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
    disputeStatus: null,
    isLifetime: false,
    latestInvoiceId: "in_current",
    paidThroughAt: daysFromNow(20),
    pastDueSince: null,
    refundedInvoiceId: null,
    status: "active",
    ...overrides,
  };
}

const NONE = { accessEndsAt: null, hasProAccess: false, isDisputed: false, isPastDue: false, reason: "none" };

describe("entitlementsFor", () => {
  it("gives no access without a subscription", () => {
    expect(entitlementsFor(null, NOW)).toEqual(NONE);
  });

  it.each(["active", "trialing"])("grants access for %s, open-ended while it renews", (status) => {
    expect(entitlementsFor(snapshot({ status }), NOW)).toEqual({
      accessEndsAt: null,
      hasProAccess: true,
      isDisputed: false,
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

  it.each(["active", "trialing"])(
    "stops granting access for %s once its scheduled cancellation time has come, without waiting for the event",
    (status) => {
      const ending = snapshot({ cancelAt: daysFromNow(2), cancelAtPeriodEnd: true, status });

      expect(entitlementsFor(ending, daysFromNow(1)).hasProAccess).toBe(true);
      expect(entitlementsFor(ending, daysFromNow(2))).toEqual(NONE);
      expect(entitlementsFor(ending, daysFromNow(3))).toEqual(NONE);
      // A cancel date left on a row that is no longer set to cancel means nothing.
      expect(entitlementsFor({ ...ending, cancelAtPeriodEnd: false }, daysFromNow(3)).hasProAccess).toBe(true);
    },
  );

  describe("past_due", () => {
    it("keeps access for the grace window counted from the first failure", () => {
      const result = entitlementsFor(snapshot({ pastDueSince: daysFromNow(-3), status: "past_due" }), NOW);

      expect(result).toEqual({
        accessEndsAt: daysFromNow(PAST_DUE_GRACE_DAYS - 3),
        hasProAccess: true,
        isDisputed: false,
        isPastDue: true,
        reason: "past_due_grace",
      });
    });

    it("ends access once the window has passed, to the millisecond", () => {
      const pastDue = snapshot({ pastDueSince: NOW, status: "past_due" });
      const windowEnd = daysFromNow(PAST_DUE_GRACE_DAYS);

      expect(entitlementsFor(pastDue, new Date(windowEnd.getTime() - 1)).hasProAccess).toBe(true);
      expect(entitlementsFor(pastDue, windowEnd)).toMatchObject({ hasProAccess: false, isPastDue: true, reason: "none" });
    });

    it("does not start a new window when a new billing period opens", () => {
      // Past due for 40 days; the current period (and its unpaid invoice)
      // began yesterday. Only the anchor counts.
      const result = entitlementsFor(
        snapshot({
          latestInvoiceId: "in_newest",
          paidThroughAt: null,
          pastDueSince: daysFromNow(-40),
          status: "past_due",
        }),
        NOW,
      );

      expect(result).toMatchObject({ hasProAccess: false, isPastDue: true });
    });

    it("denies access when the anchor is missing", () => {
      const result = entitlementsFor(snapshot({ pastDueSince: null, status: "past_due" }), NOW);

      expect(result).toEqual({ ...NONE, isPastDue: true });
    });
  });

  describe("canceled", () => {
    const canceled = (overrides: Partial<SubscriptionSnapshot> = {}) =>
      snapshot({
        cancellationReason: "cancellation_requested",
        paidThroughAt: daysFromNow(5),
        status: "canceled",
        ...overrides,
      });

    it("keeps access for a requested cancellation until the period that was paid for ends", () => {
      expect(entitlementsFor(canceled(), NOW)).toEqual({
        accessEndsAt: daysFromNow(5),
        hasProAccess: true,
        isDisputed: false,
        isPastDue: false,
        reason: "canceled_paid_period",
      });
      expect(entitlementsFor(canceled(), daysFromNow(5)).hasProAccess).toBe(false);
      expect(entitlementsFor(canceled(), daysFromNow(6)).hasProAccess).toBe(false);
    });

    it("gives nothing when the period was never paid for (failed renewal, then cancelled)", () => {
      // An annual renewal failed and the customer cancelled at once: the
      // period runs for a year on paper, but no money was taken for it.
      expect(entitlementsFor(canceled({ paidThroughAt: null }), NOW)).toEqual(NONE);
    });

    it("gives nothing when the payment for the period was refunded in full", () => {
      const refunded = canceled({ latestInvoiceId: "in_1", refundedInvoiceId: "in_1" });

      expect(entitlementsFor(refunded, NOW)).toEqual(NONE);
      // A refund of an earlier invoice does not concern the current period.
      expect(entitlementsFor({ ...refunded, refundedInvoiceId: "in_0" }, NOW).hasProAccess).toBe(true);
    });

    it("does not read a row with neither a refunded nor a latest invoice as refunded", () => {
      // null === null must not count as "the latest invoice was refunded".
      const noInvoices = canceled({ latestInvoiceId: null, refundedInvoiceId: null });
      expect(entitlementsFor(noInvoices, NOW)).toMatchObject({ hasProAccess: true, reason: "canceled_paid_period" });
    });

    it.each(["payment_failed", "payment_disputed", "canceled_by_retention_policy", null])(
      "gives no access for a subscription cancelled for %s, even with paid period left",
      (cancellationReason) => {
        expect(entitlementsFor(canceled({ cancellationReason }), NOW).hasProAccess).toBe(false);
      },
    );
  });

  describe("disputes", () => {
    it.each([
      ["past_due", true],
      ["unpaid", true],
      ["active", false],
      ["canceled", false],
    ])("still flags a payment problem under a dispute for %s: isPastDue %s", (status, isPastDue) => {
      for (const disputeStatus of ["open", "lost"]) {
        expect(entitlementsFor(snapshot({ disputeStatus, pastDueSince: NOW, status }), NOW)).toMatchObject({
          hasProAccess: false,
          isDisputed: true,
          isPastDue,
        });
      }
    });

    it.each(["active", "trialing", "past_due", "canceled"])(
      "suspends access while a dispute is open, whatever the status (%s)",
      (status) => {
        const result = entitlementsFor(
          snapshot({
            cancellationReason: "cancellation_requested",
            disputeStatus: "open",
            pastDueSince: NOW,
            status,
          }),
          NOW,
        );

        expect(result).toMatchObject({ accessEndsAt: null, hasProAccess: false, isDisputed: true, reason: "none" });
      },
    );

    it("withholds access while the last payment stands lost to a dispute, and gives it back once that is cleared", () => {
      const lost = snapshot({ disputeStatus: "lost", latestInvoiceId: "in_1" });

      expect(entitlementsFor(lost, NOW)).toMatchObject({ hasProAccess: false, isDisputed: true });
      // The standing is derived again when a later invoice is paid, and is then no longer "lost".
      expect(entitlementsFor({ ...lost, disputeStatus: null, latestInvoiceId: "in_2" }, NOW)).toMatchObject({
        hasProAccess: true,
        isDisputed: false,
      });
    });

    it("a new invoice that is not paid does not lift a lost dispute: no grace access on a failed renewal", () => {
      const failedRenewal = snapshot({
        disputeStatus: "lost",
        latestInvoiceId: "in_2",
        paidThroughAt: null,
        pastDueSince: NOW,
        status: "past_due",
      });

      expect(entitlementsFor(failedRenewal, NOW)).toMatchObject({
        accessEndsAt: null,
        hasProAccess: false,
        isDisputed: true,
        isPastDue: true,
        reason: "none",
      });
      // The same row without the loss is in its grace window.
      expect(entitlementsFor({ ...failedRenewal, disputeStatus: null }, NOW).reason).toBe("past_due_grace");
    });

    it("never suspends a comped account", () => {
      const result = entitlementsFor(snapshot({ disputeStatus: "open", isLifetime: true }), NOW);

      expect(result).toMatchObject({ hasProAccess: true, reason: "lifetime" });
    });
  });

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

    expect(result).toEqual({
      accessEndsAt: null,
      hasProAccess: true,
      isDisputed: false,
      isPastDue: false,
      reason: "lifetime",
    });
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
        // So must a period end on its own: only a PAID period counts.
        cancellationReason: "cancellation_requested",
        currentPeriodEnd: daysFromNow(30),
        paidThroughAt: null,
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
