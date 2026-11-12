import { describe, expect, it } from "vitest";

import colors, { black } from "./colors";

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5]
        .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
        .map((channel) =>
            channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
        ) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

const WHITE = "#ffffff";
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

describe("theme palette contrast (WCAG AA)", () => {
    const palettes = Object.entries(colors);
    // `tan` is the one palette that is never a filled control: it colours
    // stars and tinted notices, where it only has to reach 3:1 as a graphic.
    const filledPalettes = palettes.filter(([name]) => name !== "tan");

    it.each(filledPalettes)("%s: white text on the filled shade (6) and its hover (7)", (_name, shades) => {
        expect(contrast(WHITE, shades[6])).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(WHITE, shades[7])).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(palettes)("%s: light variant (shade 9 on shade 1, hover shade 2)", (_name, shades) => {
        expect(contrast(shades[9], shades[1])).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(shades[9], shades[2])).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("dimmed text (gray.6) on white and on every tinted surface", () => {
        const surfaces = [
            WHITE,
            colors.gray[0],
            colors.gray[1],
            colors.orange[0],
            colors.orange[1],
            colors.teal[0],
            colors.purple[0],
        ];
        for (const surface of surfaces) {
            expect(contrast(colors.gray[6], surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    it("anchors and outline buttons (orange.6) on white and on the neutral tint", () => {
        expect(contrast(colors.orange[6], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(colors.orange[6], colors.gray[0])).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("coral text on coral tints uses shade 7 or darker", () => {
        expect(contrast(colors.orange[7], colors.orange[0])).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(colors.orange[8], colors.orange[1])).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("error (red.6) and success (teal.8) text on white", () => {
        expect(contrast(colors.red[6], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(colors.teal[8], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("navigation labels: inactive gray.7, active orange.7", () => {
        expect(contrast(colors.gray[7], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(colors.orange[7], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("non-text UI: rating stars (tan.6), empty stars and input borders (gray.5)", () => {
        expect(contrast(colors.tan[6], WHITE)).toBeGreaterThanOrEqual(AA_NON_TEXT);
        expect(contrast(colors.gray[5], WHITE)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });

    it("body text", () => {
        expect(contrast(black, WHITE)).toBeGreaterThanOrEqual(7);
        expect(contrast(black, colors.orange[1])).toBeGreaterThanOrEqual(7);
    });
});
