import { describe, expect, it } from "vitest";

import { getPricingForRole } from "~/server/_utils/pricing";

import { FREE_PLAN, PRO_PLAN, formatPrice, proFeaturesFor, proPriceView } from "./plans";

const founding = getPricingForRole("founding_member");
const standard = getPricingForRole("standard");

describe("plan descriptions", () => {
  it("promise no usage limits: the server enforces none", () => {
    for (const feature of [...FREE_PLAN.features, ...PRO_PLAN.features, ...PRO_PLAN.comingSoon]) {
      expect(feature, feature).not.toMatch(/\d|unlimited|per (day|month|week)|up to/i);
    }
  });

  it("sell as current only what the server does for Pro", () => {
    // Each current benefit is built: placement (search.searchAll ranks Pro
    // first), the badge (`isPro` on every payload that shows a person),
    // analytics (insights.getSummary) and support (support.contact), the
    // last two Pro-only procedures (root.test.ts lists them).
    const built = [/placement in search/i, /badge/i, /analytics/i, /priority support/i];
    for (const pattern of built) expect(PRO_PLAN.features.some((feature) => pattern.test(feature)), String(pattern)).toBe(true);
    // Nothing that is not built: no "featured" listings, no dashboards beyond insights.
    for (const feature of PRO_PLAN.features) expect(feature, feature).not.toMatch(/featured|unlimited|early access/i);
    for (const feature of PRO_PLAN.comingSoon) expect(PRO_PLAN.features as readonly string[]).not.toContain(feature);
  });

  it("mention the founding price lock only to someone on the founding price", () => {
    expect(proFeaturesFor(founding)).toContain(PRO_PLAN.foundingFeature);
    expect(proFeaturesFor(standard)).not.toContain(PRO_PLAN.foundingFeature);
  });

  it("name the two plans once", () => {
    expect(FREE_PLAN.name).toBe("Free");
    expect(PRO_PLAN.name).toBe("Pro");
    expect(new Set(FREE_PLAN.features).size).toBe(FREE_PLAN.features.length);
    expect(new Set(PRO_PLAN.features).size).toBe(PRO_PLAN.features.length);
  });
});

describe("formatPrice", () => {
  it("drops the cents of a whole amount and keeps two otherwise", () => {
    expect(formatPrice(19)).toBe("$19");
    expect(formatPrice(8.25)).toBe("$8.25");
    expect(formatPrice(14.9)).toBe("$14.90");
  });
});

describe("proPriceView", () => {
  it("shows the server's monthly price, never a number of its own", () => {
    expect(proPriceView(founding, "monthly").perMonth).toBe(formatPrice(founding.monthlyPrice));
    expect(proPriceView(standard, "monthly").perMonth).toBe(formatPrice(standard.monthlyPrice));
    expect(proPriceView({ annualPrice: 240, isFoundingPrice: false, monthlyPrice: 25, standardMonthlyPrice: 25 }, "monthly")).toMatchObject({
      annualNote: null,
      cta: "Upgrade to Pro — $25/mo",
      perMonth: "$25",
      regularPerMonth: null,
    });
  });

  it("shows the annual price per month, with what is billed and saved", () => {
    const view = proPriceView({ annualPrice: 99, isFoundingPrice: true, monthlyPrice: 10, standardMonthlyPrice: 19 }, "annual");
    expect(view.perMonth).toBe("$8.25");
    expect(view.annualNote).toBe("$99 billed yearly — save $21 compared with monthly");
    expect(view.cta).toBe("Upgrade to Pro — $8.25/mo");
  });

  it("claims no saving when the annual price has none", () => {
    const view = proPriceView({ annualPrice: 120, isFoundingPrice: false, monthlyPrice: 10, standardMonthlyPrice: 10 }, "annual");
    expect(view.annualNote).toBe("$120 billed yearly");
  });

  it("strikes through the regular price only for the founding price", () => {
    expect(proPriceView(founding, "monthly").regularPerMonth).toBe(formatPrice(founding.standardMonthlyPrice));
    expect(proPriceView(standard, "monthly").regularPerMonth).toBeNull();
  });
});
