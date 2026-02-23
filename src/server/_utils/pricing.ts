import { env } from "~/env";
import { USER_ROLES, type UserRole } from "./roles";

export type PricingInfo = {
  monthlyPrice: number;
  annualPrice: number;
  isFoundingPrice: boolean;
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
      monthlyPrice: 10,
      annualPrice: 99,
      isFoundingPrice: true,
      standardMonthlyPrice: 19,
    };
  }

  return {
    monthlyPrice: 19,
    annualPrice: 179,
    isFoundingPrice: false,
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
