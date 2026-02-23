import { USER_ROLES, type UserRole } from "./roles";

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

export function getPriceIdForCheckout(
  role: string,
  billingInterval: "monthly" | "annual",
): string | null {
  const isFounding = FOUNDING_ROLES.includes(role as UserRole);

  if (isFounding) {
    return billingInterval === "monthly"
      ? (env.STRIPE_FOUNDING_MONTHLY_PRICE_ID ?? null)
      : (env.STRIPE_FOUNDING_ANNUAL_PRICE_ID ?? null);
  }

  return billingInterval === "monthly"
    ? (env.STRIPE_STANDARD_MONTHLY_PRICE_ID ?? null)
    : (env.STRIPE_STANDARD_ANNUAL_PRICE_ID ?? null);
}
