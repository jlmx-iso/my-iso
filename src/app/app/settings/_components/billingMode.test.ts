import type { Subscription } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

// The router module is loaded only for toSubscriptionView (a pure function).
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/server/_lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("~/env", () => ({ env: { NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_test_placeholder" } }));

import { toSubscriptionView } from "~/server/api/routers/subscription";

import { billingModeFor } from "./billingMode";

const NOW = new Date("2030-06-15T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

/** A stored row, seen through the same view the settings page gets. */
function modeOf(overrides: Partial<Subscription>) {
  const row: Subscription = {
    cancelAt: null,
    cancelAtPeriodEnd: false,
    cancellationReason: null,
    createdAt: NOW,
    currentPeriodEnd: inDays(20),
    currentPeriodStart: inDays(-10),
    disputeId: null,
    disputeInvoiceId: null,
    disputeStatus: null,
    endedAt: null,
    expiresAt: inDays(20),
    id: "row_1",
    interval: "month",
    isActive: true,
    isCanceled: false,
    isExpired: false,
    isLifetime: false,
    isPaused: false,
    isPending: false,
    isTrial: false,
    latestInvoiceId: "in_1",
    paidThroughAt: inDays(20),
    pastDueSince: null,
    plan: "standard",
    priceId: "price_standard_monthly",
    refundedInvoiceId: null,
    status: "active",
    stripeCreatedAt: inDays(-10),
    stripeCustomerId: "cus_1",
    stripeSyncedAt: NOW,
    subscriptionId: "sub_1",
    updatedAt: NOW,
    userId: "user_1",
    ...overrides,
  };
  return billingModeFor(toSubscriptionView(row, NOW));
}

describe("billingModeFor", () => {
  it("offers checkout to someone who has never subscribed", () => {
    expect(billingModeFor(null)).toBe("checkout");
  });

  it("offers nothing to a comped account", () => {
    expect(modeOf({ isLifetime: true, status: "incomplete_expired" })).toBe("none");
  });

  it("sends every subscription that has not ended to the portal, with or without access", () => {
    expect(modeOf({ status: "active" })).toBe("portal");
    expect(modeOf({ status: "trialing" })).toBe("portal");
    expect(modeOf({ pastDueSince: inDays(-30), status: "past_due" })).toBe("portal");
    expect(modeOf({ status: "paused" })).toBe("portal");
    expect(modeOf({ status: "incomplete" })).toBe("portal");
  });

  it("a subscription SET to cancel is still running: the cancellation is undone in the portal, not by a new checkout", () => {
    expect(modeOf({ cancelAt: inDays(20), cancelAtPeriodEnd: true, status: "active" })).toBe("portal");
  });

  it("cancelled outright with paid time left: a new checkout is allowed, and is called what it is", () => {
    expect(modeOf({ cancellationReason: "cancellation_requested", endedAt: inDays(-1), status: "canceled" })).toBe("resubscribe");
  });

  it("once the paid time is over (or there was none), it is a plain upgrade again", () => {
    const ended = { cancellationReason: "cancellation_requested", endedAt: inDays(-40), status: "canceled" };
    expect(modeOf({ ...ended, paidThroughAt: inDays(-10) })).toBe("checkout");
    expect(modeOf({ ...ended, cancellationReason: "payment_failed" })).toBe("checkout");
    expect(modeOf({ status: "incomplete_expired" })).toBe("checkout");
  });
});
