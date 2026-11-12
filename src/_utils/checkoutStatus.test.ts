import { describe, expect, it } from "vitest";

import {
  CHECKOUT_MAX_ATTEMPTS,
  CHECKOUT_RETRY_DELAY_MS,
  afterCheck,
  checkDelay,
  checkoutBannerState,
  isSubscriptionConfirmed,
  parseCheckoutReturn,
  shouldCheckAgain,
} from "./checkoutStatus";

describe("parseCheckoutReturn", () => {
  it("accepts only the two values Stripe sends the member back with", () => {
    expect(parseCheckoutReturn("success")).toBe("success");
    expect(parseCheckoutReturn("canceled")).toBe("canceled");
    expect(parseCheckoutReturn(["success", "canceled"])).toBe("success");
  });

  it("ignores everything else", () => {
    expect(parseCheckoutReturn(undefined)).toBeNull();
    expect(parseCheckoutReturn(null)).toBeNull();
    expect(parseCheckoutReturn("")).toBeNull();
    expect(parseCheckoutReturn("paid")).toBeNull();
    expect(parseCheckoutReturn("SUCCESS")).toBeNull();
  });
});

describe("checkoutBannerState", () => {
  const base = { attempts: 0, checkout: "success" as const, isSubscriptionActive: false };

  it("shows nothing without a checkout parameter, whatever the plan", () => {
    expect(checkoutBannerState({ ...base, checkout: null })).toBe("none");
    expect(checkoutBannerState({ ...base, checkout: null, isSubscriptionActive: true })).toBe("none");
  });

  it("confirms Pro only when the server says the subscription is active", () => {
    expect(checkoutBannerState({ ...base, isSubscriptionActive: true })).toBe("confirmed");
  });

  it("never trusts ?checkout=success on its own: it waits for the subscription", () => {
    expect(checkoutBannerState(base)).toBe("confirming");
    expect(checkoutBannerState({ ...base, attempts: CHECKOUT_MAX_ATTEMPTS - 1 })).toBe("confirming");
  });

  it("stops waiting after the last retry and says it is taking longer", () => {
    expect(checkoutBannerState({ ...base, attempts: CHECKOUT_MAX_ATTEMPTS })).toBe("delayed");
    expect(checkoutBannerState({ ...base, attempts: 2, maxAttempts: 2 })).toBe("delayed");
  });

  it("switches to confirmed as soon as a retry finds the subscription", () => {
    expect(checkoutBannerState({ ...base, attempts: 3, isSubscriptionActive: true })).toBe("confirmed");
    expect(
      checkoutBannerState({ ...base, attempts: CHECKOUT_MAX_ATTEMPTS, isSubscriptionActive: true }),
    ).toBe("confirmed");
  });

  it("reports a canceled checkout, unless the member is on Pro anyway", () => {
    expect(checkoutBannerState({ ...base, checkout: "canceled" })).toBe("canceled");
    expect(checkoutBannerState({ ...base, checkout: "canceled", isSubscriptionActive: true })).toBe("none");
  });
});

describe("confirming a subscription after checkout", () => {
  const start = { attempts: 0, isActive: false };
  const pro = { hasProAccess: true, status: "active" };

  it("is confirmed by hasProAccess, not by the deprecated isActive", () => {
    expect(isSubscriptionConfirmed(pro)).toBe(true);
    expect(isSubscriptionConfirmed({ hasProAccess: false, isActive: true })).toBe(false);
    expect(isSubscriptionConfirmed({ isActive: true })).toBe(false);
    expect(isSubscriptionConfirmed(null)).toBe(false);
    expect(isSubscriptionConfirmed(undefined)).toBe(false);
  });

  it("turns active on the first answer that grants Pro, and stays active", () => {
    const active = afterCheck(start, { ok: true, subscription: pro });
    expect(active).toEqual({ attempts: 0, isActive: true });
    expect(afterCheck(active, { ok: false })).toBe(active);
    expect(afterCheck(active, { ok: true, subscription: null })).toBe(active);
  });

  it("counts an answer without Pro, and a failed request, as an attempt", () => {
    expect(afterCheck(start, { ok: true, subscription: { hasProAccess: false } })).toEqual({ attempts: 1, isActive: false });
    expect(afterCheck(start, { ok: true, subscription: null })).toEqual({ attempts: 1, isActive: false });
    expect(afterCheck(start, { ok: false })).toEqual({ attempts: 1, isActive: false });
  });

  it("checks at once, then waits between checks", () => {
    expect(checkDelay(0)).toBe(0);
    expect(checkDelay(1)).toBe(CHECKOUT_RETRY_DELAY_MS);
  });

  it("stops when active, when not wanted, and after the last attempt", () => {
    expect(shouldCheckAgain(start, true)).toBe(true);
    expect(shouldCheckAgain(start, false)).toBe(false);
    expect(shouldCheckAgain({ attempts: 0, isActive: true }, true)).toBe(false);
    expect(shouldCheckAgain({ attempts: CHECKOUT_MAX_ATTEMPTS - 1, isActive: false }, true)).toBe(true);
    expect(shouldCheckAgain({ attempts: CHECKOUT_MAX_ATTEMPTS, isActive: false }, true)).toBe(false);
  });

  it("gives up after exactly the allowed number of checks when the webhook never lands", () => {
    let state = start;
    let checks = 0;
    while (shouldCheckAgain(state, true)) {
      checks += 1;
      state = afterCheck(state, { ok: true, subscription: { hasProAccess: false } });
    }
    expect(checks).toBe(CHECKOUT_MAX_ATTEMPTS);
    expect(checkoutBannerState({ attempts: state.attempts, checkout: "success", isSubscriptionActive: state.isActive })).toBe("delayed");
  });

  it("is confirmed as soon as a later check finds Pro", () => {
    let state = afterCheck(start, { ok: true, subscription: { hasProAccess: false } });
    state = afterCheck(state, { ok: false });
    state = afterCheck(state, { ok: true, subscription: pro });
    expect(shouldCheckAgain(state, true)).toBe(false);
    expect(checkoutBannerState({ attempts: state.attempts, checkout: "success", isSubscriptionActive: state.isActive })).toBe("confirmed");
  });
});
