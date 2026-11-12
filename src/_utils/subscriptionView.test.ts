import { describe, expect, it } from "vitest";

import { type SubscriptionState, billingIssueOf, hasProAccess, subscriptionSummary } from "./subscriptionView";

const renewal = new Date("2026-12-01T00:00:00Z");
const graceEnd = new Date("2026-11-20T00:00:00Z");

const active: SubscriptionState = {
  accessEndsAt: null,
  cancelAt: null,
  cancelAtPeriodEnd: false,
  canStartCheckout: false,
  currentPeriodEnd: renewal,
  hasProAccess: true,
  interval: "month",
  isLifetime: false,
  isPastDue: false,
  plan: "founding",
  renewsAt: renewal,
  status: "active",
};

describe("hasProAccess", () => {
  it("reads the current field only", () => {
    expect(hasProAccess(active)).toBe(true);
    expect(hasProAccess({ hasProAccess: false })).toBe(false);
    expect(hasProAccess(null)).toBe(false);
    // The deprecated flag alone does not grant anything.
    expect(hasProAccess({ isActive: true } as unknown as SubscriptionState)).toBe(false);
  });
});

describe("subscriptionSummary", () => {
  it("is Free for someone who never subscribed", () => {
    expect(subscriptionSummary(null)).toMatchObject({
      banner: null,
      line: { date: null, text: "You're on the Free plan." },
      planName: "Free",
    });
  });

  it("shows the plan and the renewal date of an active subscription, managed in the portal", () => {
    expect(subscriptionSummary(active)).toMatchObject({
      banner: null,
      line: { date: renewal, text: "Renews on {date}." },
      planDetail: "Founding price · Monthly",
      planName: "Pro",
      portalLabel: "Manage subscription",
    });
    expect(subscriptionSummary({ ...active, interval: "year", plan: "standard" }).planDetail).toBe("Yearly");
  });

  it("says when a trial turns into a paid subscription", () => {
    expect(subscriptionSummary({ ...active, status: "trialing" }).line.text).toMatch(/first payment is on \{date\}/);
  });

  it("warns about a failed payment while access continues, with Fix payment opening the portal", () => {
    const summary = subscriptionSummary({ ...active, accessEndsAt: graceEnd, isPastDue: true, renewsAt: null, status: "past_due" });
    expect(summary.planName).toBe("Pro");
    expect(summary.portalLabel).toBe("Fix payment");
    expect(summary.banner).toMatchObject({ actionLabel: "Fix payment", date: graceEnd, tone: "red" });
    expect(summary.banner?.title).toMatch(/payment didn't go through/);
  });

  it("explains a subscription that exists but gives no access", () => {
    const lapsed = { ...active, hasProAccess: false, renewsAt: null };
    for (const status of ["unpaid", "paused", "incomplete", "past_due", "something_new"]) {
      const summary = subscriptionSummary({ ...lapsed, status });
      expect(summary.planName, status).toBe("Free");
      expect(summary.banner, status).not.toBeNull();
      expect(summary.line.text, status).toMatch(/switched off/);
    }
  });

  it("believes the server's billingIssue when it sends one", () => {
    const disputed = { ...active, billingIssue: "disputed", hasProAccess: false, isDisputed: true, renewsAt: null };
    expect(billingIssueOf(disputed)).toBe("disputed");
    expect(subscriptionSummary(disputed).banner?.title).toMatch(/dispute/);
    expect(billingIssueOf({ ...active, billingIssue: "paused", hasProAccess: false, status: "paused" })).toBe("paused");
    expect(billingIssueOf({ ...active, billingIssue: null })).toBeNull();
    // A value this release does not know falls back to what the state shows.
    expect(billingIssueOf({ ...active, billingIssue: "mystery" })).toBeNull();
  });

  it("says until when a subscription set to end keeps Pro, and lets it be resumed in the portal", () => {
    const summary = subscriptionSummary({ ...active, accessEndsAt: renewal, cancelAt: renewal, cancelAtPeriodEnd: true, renewsAt: null });
    expect(summary).toMatchObject({ banner: null, planName: "Pro", portalLabel: "Resume or manage" });
    expect(summary.line).toEqual({
      date: renewal,
      text: "Your subscription is canceled. You keep Pro until {date}, and you won't be charged again.",
    });
  });

  it("keeps Pro for a cancelled subscription with paid time left, and allows a new checkout", () => {
    const summary = subscriptionSummary({
      ...active,
      accessEndsAt: renewal,
      canStartCheckout: true,
      renewsAt: null,
      status: "canceled",
    });
    expect(summary).toMatchObject({ planName: "Pro" });
    expect(summary.line.date).toEqual(renewal);
  });

  it("is Free again once a cancelled subscription has run out", () => {
    const summary = subscriptionSummary({
      ...active,
      accessEndsAt: renewal,
      canStartCheckout: true,
      hasProAccess: false,
      renewsAt: null,
      status: "canceled",
    });
    expect(summary).toMatchObject({ banner: null, planName: "Free" });
    expect(summary.line).toEqual({ date: renewal, text: "Your Pro subscription ended on {date}. You're on the Free plan." });
  });

  it("has nothing to manage for a comped account", () => {
    const summary = subscriptionSummary({ ...active, isLifetime: true, isPastDue: true, renewsAt: null });
    expect(summary).toMatchObject({ banner: null, planDetail: "Complimentary", planName: "Pro" });
  });
});

describe("a subscription that ended early", () => {
  it("never says it ended on a date that is still ahead", () => {
    const summary = subscriptionSummary({
      ...active,
      accessEndsAt: null,
      canStartCheckout: true,
      hasProAccess: false,
      renewsAt: null,
      status: "canceled",
    });
    expect(summary.line).toEqual({ date: null, text: "Your Pro subscription has ended. You're on the Free plan." });
  });
});
