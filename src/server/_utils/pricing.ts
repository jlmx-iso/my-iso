import { env } from "~/env";

import { USER_ROLES, type UserRole } from "./roles";

export type PricingInfo = {
  annualPrice: number;
  isFoundingPrice: boolean;
  monthlyPrice: number;
  standardMonthlyPrice: number;
};

const FOUNDING_ROLES: readonly UserRole[] = [
  USER_ROLES.FOUNDING_MEMBER,
  USER_ROLES.FOUNDER,
  USER_ROLES.AMBASSADOR,
];

export type PlanTier = "founding" | "standard";
export type BillingInterval = "monthly" | "annual";

/** Which price list a role buys from. Decided on the server, never by the client. */
export function planTierForRole(role: string): PlanTier {
  return FOUNDING_ROLES.some((founding) => founding === role) ? "founding" : "standard";
}

/**
 * The prices shown to a role. Display only: what is charged is the Stripe
 * Price configured for the tier (see getPriceIdForCheckout); keep the two in
 * step when a price changes.
 */
export function getPricingForRole(role: string): PricingInfo {
  if (planTierForRole(role) === "founding") {
    return {
      annualPrice: 99,
      isFoundingPrice: true,
      monthlyPrice: 10,
      standardMonthlyPrice: 19,
    };
  }

  return {
    annualPrice: 179,
    isFoundingPrice: false,
    monthlyPrice: 19,
    standardMonthlyPrice: 19,
  };
}

/** The Stripe Price ids, as configured in the environment. */
export type PriceConfig = {
  STRIPE_FOUNDING_ANNUAL_PRICE_ID?: string;
  STRIPE_FOUNDING_MONTHLY_PRICE_ID?: string;
  STRIPE_STANDARD_ANNUAL_PRICE_ID?: string;
  STRIPE_STANDARD_MONTHLY_PRICE_ID?: string;
};

const PRICE_ENV_VARS = {
  "founding:annual": "STRIPE_FOUNDING_ANNUAL_PRICE_ID",
  "founding:monthly": "STRIPE_FOUNDING_MONTHLY_PRICE_ID",
  "standard:annual": "STRIPE_STANDARD_ANNUAL_PRICE_ID",
  "standard:monthly": "STRIPE_STANDARD_MONTHLY_PRICE_ID",
} as const satisfies Record<`${PlanTier}:${BillingInterval}`, keyof PriceConfig>;

/** A plan has no Stripe Price configured: checkout cannot be offered. */
export class PriceNotConfiguredError extends Error {
  readonly envVar: string;

  constructor(envVar: string) {
    super(`${envVar} is not set: no Stripe Price is configured for this plan`);
    this.name = "PriceNotConfiguredError";
    this.envVar = envVar;
  }
}

/**
 * The Stripe Price a user with `role` is charged for `billingInterval`.
 *
 * Prices live in Stripe and are referenced by id from configuration; there
 * is no inline-price fallback, because an ad-hoc price would create a new,
 * unreportable product on every checkout and could drift from the catalogue.
 * Throws PriceNotConfiguredError when the id is missing.
 */
export function getPriceIdForCheckout(
  role: string,
  billingInterval: BillingInterval,
  config: PriceConfig = env,
): string {
  const envVar = PRICE_ENV_VARS[`${planTierForRole(role)}:${billingInterval}`];
  const priceId = config[envVar];
  if (!priceId) throw new PriceNotConfiguredError(envVar);
  return priceId;
}

/**
 * Which configured plan a Stripe Price id is, or null for a price this app
 * does not sell (a legacy or hand-made subscription).
 */
export function planForPriceId(
  priceId: string,
  config: PriceConfig = env,
): { billingInterval: BillingInterval; plan: PlanTier } | null {
  const tiers: PlanTier[] = ["founding", "standard"];
  const intervals: BillingInterval[] = ["monthly", "annual"];
  for (const plan of tiers) {
    for (const billingInterval of intervals) {
      if (config[PRICE_ENV_VARS[`${plan}:${billingInterval}`]] === priceId) {
        return { billingInterval, plan };
      }
    }
  }
  return null;
}
