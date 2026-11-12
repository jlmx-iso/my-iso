import { describe, expect, it } from "vitest";

import { PRO_PLAN } from "~/_utils/plans";

import { renderUpgradePitchEmail } from "./upgrade-pitch";

const props = {
  bookingCount: 3,
  firstName: "Ada",
  messageCount: 12,
  profileViews: 40,
  upgradeUrl: "https://example.com/app/settings",
};

/** The text of the email paragraph marked `data-section`. */
function section(html: string, name: string): string {
  const match = new RegExp(`<p[^>]*data-section="${name}"[^>]*>([\\s\\S]*?)</p>`).exec(html);
  if (!match?.[1]) throw new Error(`no section ${name}`);
  return match[1].replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
}

/** What Pro does not do yet (nothing is gated on Pro): it may only appear under "Coming soon". */
const PLANNED = /priority|badge|featured|analytics|dashboard|unlimited|early access/i;

describe("upgrade pitch email", () => {
  it("lists only what Pro gives today as current benefits", async () => {
    const now = section(await renderUpgradePitchEmail(props), "pro-now");
    expect(now).not.toMatch(PLANNED);
    for (const feature of PRO_PLAN.features) expect(now).toContain(feature);
  });

  it("puts every planned feature under 'Coming soon', from the same list as the site", async () => {
    const html = await renderUpgradePitchEmail(props);
    expect(html).toContain("Coming soon (not yet available)");
    const soon = section(html, "pro-coming-soon");
    for (const feature of PRO_PLAN.comingSoon) expect(soon).toContain(feature);
  });

  it("mentions the founding price lock only to founding members", async () => {
    expect(section(await renderUpgradePitchEmail({ ...props, isFoundingPrice: true }), "pro-now")).toContain(
      PRO_PLAN.foundingFeature,
    );
    expect(section(await renderUpgradePitchEmail(props), "pro-now")).not.toContain(PRO_PLAN.foundingFeature);
  });

  it("promises no limit the free plan does not have", async () => {
    const text = (await renderUpgradePitchEmail(props)).replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/unlimited|early access/i);
  });
});
