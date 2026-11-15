// Every text colour the email styles define, on the background it is used
// on, meets WCAG AA (4.5:1; the bar for normal-size text, so large text
// passes too). Templates take their colours from styles.ts only.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  calloutBox,
  calloutText,
  colors,
  ctaButton,
  heading,
  layout,
  linkStyle,
  paragraph,
  proCalloutBox,
  secondaryButton,
  signature,
  smallText,
} from "./styles";

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const AA_TEXT = 4.5;

const hex = (value: unknown): string => {
  expect(value).toMatch(/^#[0-9a-f]{6}$/);
  return String(value);
};

/** [what, text colour, background]. The card under the content is white. */
const PAIRS: [string, unknown, unknown][] = [
  ["heading", heading.color, colors.white],
  ["paragraph", paragraph.color, colors.white],
  ["signature", signature.color, colors.white],
  ["small text", smallText.color, colors.white],
  ["link", linkStyle.color, colors.white],
  ["main button", ctaButton.color, ctaButton.backgroundColor],
  ["secondary button", secondaryButton.color, secondaryButton.backgroundColor],
  ["callout text", calloutText.color, calloutBox.backgroundColor],
  ["link in a callout", linkStyle.color, calloutBox.backgroundColor],
  ["accent text in a callout (sign-in code)", colors.brandInk, calloutBox.backgroundColor],
  ["Pro callout text", calloutText.color, proCalloutBox.backgroundColor],
  ["Pro accent (upgrade pitch figures)", colors.proInk, colors.white],
  ["Pro accent in a Pro callout", colors.proInk, proCalloutBox.backgroundColor],
  ["muted text in a callout", colors.muted, calloutBox.backgroundColor],
  ["logo", layout.logo.color, layout.header.backgroundColor],
  ["footer brand", layout.footerBrand.color, layout.footer.backgroundColor],
  ["footer text", layout.footerText.color, layout.footer.backgroundColor],
  ["unsubscribe link", layout.unsubscribeLink.color, layout.footer.backgroundColor],
];

describe("email colours", () => {
  it.each(PAIRS)("%s reads at 4.5:1 or more", (_what, text, background) => {
    expect(contrast(hex(text), hex(background))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("use the brand salmon as a fill only, never as text on white", () => {
    expect(contrast(colors.brand, colors.white)).toBeLessThan(AA_TEXT);
    for (const [, text] of PAIRS) expect(text).not.toBe(colors.brand);
  });

  it("come from styles.ts in every template", () => {
    const dir = path.resolve(__dirname, "..");
    const templates = readdirSync(dir).filter((file) => file.endsWith(".tsx") && !file.includes(".test."));
    expect(templates.length).toBeGreaterThan(10);
    for (const file of [...templates, "components/Layout.tsx"]) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });
});
