/**
 * What the plans are and what they cost, for every screen that shows them
 * (onboarding's plan step, Settings, the landing page). One module, so two
 * screens cannot describe the same plan differently.
 *
 * Prices are not here: they come from the server for the member's role
 * (`getPricingForRole` / `subscription.getPricing`) and are only formatted
 * here. Nothing in these lists is a usage limit: the server does not enforce
 * any per-plan limit today, so none is promised.
 */
export type PlanPricing = {
  annualPrice: number;
  isFoundingPrice: boolean;
  monthlyPrice: number;
  standardMonthlyPrice: number;
};

export type BillingInterval = "monthly" | "annual";

export const FREE_PLAN = {
  features: [
    "A photographer profile and portfolio",
    "Browse, post and apply to events",
    "Match with photographers in Discover",
    "Message the people you connect with",
  ],
  name: "Free",
} as const;

export const PRO_PLAN = {
  features: [
    "Everything in Free",
    "Priority search placement",
    "Featured profile badge",
    "Analytics dashboard",
    "Priority support",
  ],
  name: "Pro",
} as const;

/** "$10", "$8.25": whole dollars without cents. */
export function formatPrice(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export type ProPriceView = {
  /** What a month costs on this interval: "$10", "$8.25". */
  perMonth: string;
  /** The label of the upgrade button. */
  cta: string;
  /** "$99 billed yearly — save $21 compared with monthly"; null on monthly. */
  annualNote: string | null;
  /** The regular price to strike through, when this is the founding price. */
  regularPerMonth: string | null;
};

/** How Pro's price reads for a billing interval, from the server's prices. */
export function proPriceView(pricing: PlanPricing, interval: BillingInterval): ProPriceView {
  const monthly = interval === "monthly" ? pricing.monthlyPrice : Math.round((pricing.annualPrice / 12) * 100) / 100;
  const perMonth = formatPrice(monthly);
  const savings = pricing.monthlyPrice * 12 - pricing.annualPrice;
  const billedYearly = `${formatPrice(pricing.annualPrice)} billed yearly`;
  return {
    annualNote:
      interval === "annual"
        ? savings > 0
          ? `${billedYearly} — save ${formatPrice(savings)} compared with monthly`
          : billedYearly
        : null,
    cta: `Upgrade to ${PRO_PLAN.name} — ${perMonth}/mo`,
    perMonth,
    regularPerMonth: pricing.isFoundingPrice ? formatPrice(pricing.standardMonthlyPrice) : null,
  };
}
