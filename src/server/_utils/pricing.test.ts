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

import { getPriceIdForCheckout, getPricingForRole } from "./pricing";

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

describe("getPriceIdForCheckout", () => {
  it("returns null when env var is not set (standard monthly)", () => {
    const priceId = getPriceIdForCheckout("standard", "monthly");
    expect(priceId).toBeNull();
  });

  it("returns null when env var is not set (founding annual)", () => {
    const priceId = getPriceIdForCheckout("founding_member", "annual");
    expect(priceId).toBeNull();
  });

  it("returns null for unknown role + any interval", () => {
    const priceId = getPriceIdForCheckout("unknown", "monthly");
    expect(priceId).toBeNull();
  });
});
