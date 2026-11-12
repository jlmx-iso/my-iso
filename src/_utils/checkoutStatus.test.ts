import { describe, expect, it } from "vitest";

import { CHECKOUT_MAX_ATTEMPTS, checkoutBannerState, parseCheckoutReturn } from "./checkoutStatus";

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
