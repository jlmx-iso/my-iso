import { formatPrice, type PlanPricing } from "~/_utils/plans";

/** Where a member cancels Pro, as the Settings page labels it. */
export const MANAGE_SUBSCRIPTION_LOCATION = "Settings → Current plan → Manage subscription";

/** What is charged each time: the yearly total for an annual plan, the monthly price otherwise. */
export function chargedPrice(pricing: PlanPricing, annual: boolean): string {
  return formatPrice(annual ? pricing.annualPrice : pricing.monthlyPrice);
}

/** The auto-renewal disclosure shown next to every button that starts a subscription. */
export function renewalTerms(pricing: PlanPricing, annual: boolean): string {
  return `Renews automatically every ${annual ? "year" : "month"} at ${chargedPrice(pricing, annual)} until you cancel. Cancel anytime in ${MANAGE_SUBSCRIPTION_LOCATION}.`;
}
