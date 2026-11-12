/**
 * What the plans are and what they cost, for every screen that shows them
 * (onboarding's plan step, Settings, the landing page). One module, so two
 * screens cannot describe the same plan differently.
 *
 * Prices are not here: they come from the server for the member's role
 * (`getPricingForRole` / `subscription.getPricing`) and are only formatted
 * here. Nothing in these lists is a usage limit: the server does not enforce
 * any per-plan limit today, so none is promised.
 *
 * Pro gates nothing yet (no procedure uses `proProcedure`). So Pro's
 * `features` say only what is true today, and everything planned is in
 * `comingSoon`, which every screen shows under a "Coming soon" heading and
 * never as a current benefit.
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
  /** Planned, not built. Shown only under a "Coming soon" heading. */
  comingSoon: ["Priority placement in search", "A Pro badge on your profile", "Profile analytics", "Priority support"],
  /** True today. */
  features: ["Everything in Free", "Support ISO while the network is being built"],
  /** True today for a founding price only: Stripe keeps a subscription on the price it started with. */
  foundingFeature: "Your founding price stays the same for as long as you stay subscribed",
  name: "Pro",
} as const;

/** What Pro gives today, for this member's price. */
export function proFeaturesFor(pricing: Pick<PlanPricing, "isFoundingPrice">): string[] {
  return pricing.isFoundingPrice ? [...PRO_PLAN.features, PRO_PLAN.foundingFeature] : [...PRO_PLAN.features];
}

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
