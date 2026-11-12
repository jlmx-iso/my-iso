import { describe, expect, it, vi, afterEach } from "vitest";

// Mock ~/env so createEnv validation doesn't run and we can control env vars
vi.mock("~/env", () => ({
  env: {
    NODE_ENV: "test",
    STRIPE_FOUNDING_ANNUAL_PRICE_ID: undefined,
    STRIPE_FOUNDING_MONTHLY_PRICE_ID: undefined,
    STRIPE_STANDARD_ANNUAL_PRICE_ID: undefined,
    STRIPE_STANDARD_MONTHLY_PRICE_ID: undefined,
  },
}));

// Mock logger to avoid noise
vi.mock("~/_utils", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  getPriceIdForCheckout,
  getPricingForRole,
  planForPriceId,
  PriceNotConfiguredError,
} from "./pricing";

afterEach(() => {
  vi.clearAllMocks();
});

describe("getPricingForRole", () => {
  it("returns standard pricing for 'standard' role", () => {
    const p = getPricingForRole("standard");
    expect(p.monthlyPrice).toBe(19);
    expect(p.annualPrice).toBe(179);
    expect(p.isFoundingPrice).toBe(false);
  });

  it("returns founding pricing for 'founding_member' role", () => {
    const p = getPricingForRole("founding_member");
    expect(p.monthlyPrice).toBe(10);
    expect(p.annualPrice).toBe(99);
    expect(p.isFoundingPrice).toBe(true);
  });

  it("returns founding pricing for 'founder' role", () => {
    const p = getPricingForRole("founder");
    expect(p.isFoundingPrice).toBe(true);
    expect(p.monthlyPrice).toBe(10);
  });

  it("returns founding pricing for 'ambassador' role", () => {
    const p = getPricingForRole("ambassador");
    expect(p.isFoundingPrice).toBe(true);
    expect(p.monthlyPrice).toBe(10);
  });

  it("falls back to standard pricing for unknown role", () => {
    const p = getPricingForRole("unknown_role");
    expect(p.isFoundingPrice).toBe(false);
    expect(p.monthlyPrice).toBe(19);
  });

  it("always includes standardMonthlyPrice of 19", () => {
    const founding = getPricingForRole("founding_member");
    const standard = getPricingForRole("standard");
    expect(founding.standardMonthlyPrice).toBe(19);
    expect(standard.standardMonthlyPrice).toBe(19);
  });
});

const PRICES = {
  STRIPE_FOUNDING_ANNUAL_PRICE_ID: "price_founding_annual",
  STRIPE_FOUNDING_MONTHLY_PRICE_ID: "price_founding_monthly",
  STRIPE_STANDARD_ANNUAL_PRICE_ID: "price_standard_annual",
  STRIPE_STANDARD_MONTHLY_PRICE_ID: "price_standard_monthly",
};

describe("getPriceIdForCheckout", () => {
  it("picks the standard price for a standard member", () => {
    expect(getPriceIdForCheckout("standard", "monthly", PRICES)).toBe("price_standard_monthly");
    expect(getPriceIdForCheckout("standard", "annual", PRICES)).toBe("price_standard_annual");
  });

  it("picks the founding price for founding roles", () => {
    expect(getPriceIdForCheckout("founding_member", "annual", PRICES)).toBe("price_founding_annual");
    expect(getPriceIdForCheckout("founder", "monthly", PRICES)).toBe("price_founding_monthly");
    expect(getPriceIdForCheckout("ambassador", "monthly", PRICES)).toBe("price_founding_monthly");
  });

  it("treats an unknown role as standard", () => {
    expect(getPriceIdForCheckout("unknown", "monthly", PRICES)).toBe("price_standard_monthly");
  });

  it("throws, naming the variable, when the price is not configured (no inline fallback)", () => {
    expect(() => getPriceIdForCheckout("standard", "monthly")).toThrow(PriceNotConfiguredError);
    expect(() => getPriceIdForCheckout("founding_member", "annual", {})).toThrow(
      /STRIPE_FOUNDING_ANNUAL_PRICE_ID/,
    );
  });
});

describe("planForPriceId", () => {
  it("maps a configured price id back to its plan and interval", () => {
    expect(planForPriceId("price_founding_annual", PRICES)).toEqual({ billingInterval: "annual", plan: "founding" });
    expect(planForPriceId("price_standard_monthly", PRICES)).toEqual({ billingInterval: "monthly", plan: "standard" });
  });

  it("returns null for a price this app does not sell", () => {
    expect(planForPriceId("price_other", PRICES)).toBeNull();
    expect(planForPriceId("price_other", {})).toBeNull();
  });
});
