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

/** What Pro does not do: it may never appear as a current benefit. */
const NOT_BUILT = /featured|unlimited|early access/i;

describe("upgrade pitch email", () => {
  it("lists what Pro gives today, from the same list as the site", async () => {
    const now = section(await renderUpgradePitchEmail(props), "pro-now");
    expect(now).not.toMatch(NOT_BUILT);
    for (const feature of PRO_PLAN.features) expect(now).toContain(feature);
  });

  it("shows a 'Coming soon' section only when something is planned", async () => {
    const html = await renderUpgradePitchEmail(props);
    if (PRO_PLAN.comingSoon.length === 0) {
      expect(html).not.toContain("Coming soon");
      return;
    }
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
