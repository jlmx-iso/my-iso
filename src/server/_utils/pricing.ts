import { USER_ROLES, type UserRole } from "./roles";

import { logger } from "~/_utils";
import { env } from "~/env";

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

export function getPricingForRole(role: string): PricingInfo {
  const isFounding = FOUNDING_ROLES.includes(role as UserRole);

  if (isFounding) {
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

const PRICE_ENV_VAR_MAP = {
  "founding:annual": "STRIPE_FOUNDING_ANNUAL_PRICE_ID",
  "founding:monthly": "STRIPE_FOUNDING_MONTHLY_PRICE_ID",
  "standard:annual": "STRIPE_STANDARD_ANNUAL_PRICE_ID",
  "standard:monthly": "STRIPE_STANDARD_MONTHLY_PRICE_ID",
} as const;

export function getPriceIdForCheckout(
  role: string,
  billingInterval: "monthly" | "annual",
): string | null {
  const isFounding = FOUNDING_ROLES.includes(role as UserRole);
  const tier = isFounding ? "founding" : "standard";
  const key = `${tier}:${billingInterval}` as keyof typeof PRICE_ENV_VAR_MAP;
  const envVarName = PRICE_ENV_VAR_MAP[key];

  const priceId = env[envVarName] ?? null;

  if (!priceId) {
    logger.warn(`Missing ${envVarName} — falling back to inline price_data. Set this env var in production to use Stripe Price objects.`);
  }

  return priceId;
}
