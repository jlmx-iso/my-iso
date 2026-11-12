import { describe, expect, it } from "vitest";

import colors, { black } from "./colors";
import { DARK_LIGHT_ALPHA, DARK_LIGHT_HOVER_ALPHA, DARK_TINTED, darkLightVariables, withAlpha } from "./darkVariants";

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

/** `hex` at `alpha` over the opaque `under`, as the composited `#rrggbb`. */
function over(hex: string, alpha: number, under: string): string {
    return `#${[1, 3, 5]
        .map((start) => {
            const top = parseInt(hex.slice(start, start + 2), 16);
            const bottom = parseInt(under.slice(start, start + 2), 16);
            return Math.round(top * alpha + bottom * (1 - alpha)).toString(16).padStart(2, "0");
        })
        .join("")}`;
}

describe("dark mode contrast (WCAG AA), as Mantine maps the palette", () => {
    const { dark } = colors;
    const page = dark[7];
    const card = dark[6];
    const raised = dark[5];
    const surfaces = [page, card, raised];
    const textPalettes = ["orange", "teal", "red", "blue", "green", "purple", "tan"] as const;

    it("body text (dark.0), secondary text (dark.1) and dimmed text (dark.2) on the page, cards and raised surfaces", () => {
        for (const surface of surfaces) {
            expect(contrast(dark[0], surface)).toBeGreaterThanOrEqual(7);
            expect(contrast(dark[1], surface)).toBeGreaterThanOrEqual(AA_TEXT);
            expect(contrast(dark[2], surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    // `c="<name>"` is shade 4 in dark mode; purple is overridden to shade 3
    // (ThemeProvider's cssVariablesResolver).
    const textShade = (name: (typeof textPalettes)[number]) => (name === "purple" ? colors.purple[3] : colors[name][4]);

    it.each(textPalettes)("%s: coloured text on the page and on cards", (name) => {
        for (const surface of [page, card]) {
            expect(contrast(textShade(name), surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    it.each(DARK_TINTED)("%s: light variant (shade 0 on translucent shade 6) reads, and shows on the page and on cards", (name) => {
        expect(darkLightVariables[`--mantine-color-${name}-light`]).toBe(withAlpha(colors[name][6], DARK_LIGHT_ALPHA));
        for (const surface of [page, card]) {
            for (const alpha of [DARK_LIGHT_ALPHA, DARK_LIGHT_HOVER_ALPHA]) {
                const tint = over(colors[name][6], alpha, surface);
                // The text on it.
                expect(contrast(colors[name][0], tint)).toBeGreaterThanOrEqual(AA_TEXT);
                // The badge itself stands out from what it sits on (Mantine's
                // default, half-darkened shade 9, is about 1.0:1: invisible).
                expect(contrast(tint, surface)).toBeGreaterThanOrEqual(1.1);
            }
        }
    });

    it("filled controls keep white text on shade 6, and borders and input borders show", () => {
        expect(contrast(WHITE, colors.orange[6])).toBeGreaterThanOrEqual(AA_TEXT);
        // Input borders (gray.5, globals.css) and the focus ring (blue.4) on the page and cards.
        for (const surface of [page, card]) {
            expect(contrast(colors.gray[5], surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
            expect(contrast(colors.blue[4], surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
        }
    });
});
