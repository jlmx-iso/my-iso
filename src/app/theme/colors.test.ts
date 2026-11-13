import { createTheme, isLightColor, mergeMantineTheme, DEFAULT_THEME } from "@mantine/core";
import { describe, expect, it } from "vitest";

import colors, { black } from "./colors";
import theme from "./index";
import {
    BRAND_SHADE,
    DARK_TEXT_SHADE,
    HOVER_TINT_ALPHA,
    INK,
    noticeVars,
    notificationColor,
    PALETTES,
    schemeVariables,
    TEXT_SHADE,
    variantColorResolver,
    withAlpha,
} from "./variants";

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
const { dark } = colors;
const page = dark[7];
const card = dark[6];
const raised = dark[5];

/** The hex a palette variable (`var(--mantine-color-<name>-<n>)` or black) stands for. */
function resolve(value: string | undefined): string {
    if (value === "var(--mantine-color-black)") return black;
    const match = /^var\(--mantine-color-([a-z]+)-(\d)\)$/.exec(value ?? "");
    if (!match) throw new Error(`not a palette variable: ${value}`);
    const [, name, index] = match as unknown as [string, keyof typeof colors, string];
    return colors[name][Number(index)]!;
}

const LIGHT = schemeVariables("light");
const DARK = schemeVariables("dark");
const v = (vars: Record<string, string>, name: string, role: string) => resolve(vars[`--mantine-color-${name}-${role}`]);
const notice = (vars: Record<string, string>, name: string, role: string) => resolve(vars[`--iso-${name}-notice-${role}`]);

describe("the brand is the original ISO palette", () => {
    it("pins the brand pastels to the original colours", () => {
        // Within a hair (2 per channel) of the original hex, so the hue cannot drift again.
        const near = (hex: string, original: string) =>
            [1, 3, 5].every((start) => Math.abs(parseInt(hex.slice(start, start + 2), 16) - parseInt(original.slice(start, start + 2), 16)) <= 2);
        expect(near(colors.orange[BRAND_SHADE], "#e98f7b")).toBe(true);
        expect(near(colors.tan[BRAND_SHADE], "#e9bd7b")).toBe(true);
        expect(near(colors.teal[BRAND_SHADE], "#95cfc9")).toBe(true);
        expect(near(colors.purple[BRAND_SHADE], "#9b98c5")).toBe(true);
    });

    it("fills controls with the pastel in both schemes and lets dark text carry the contrast", () => {
        expect(theme.primaryColor).toBe("orange");
        expect(theme.primaryShade).toEqual({ dark: BRAND_SHADE, light: BRAND_SHADE });
        expect(theme.autoContrast).toBe(true);
        expect(theme.black).toBe(INK);
        // Mantine picks the dark text for every pastel: each is above the threshold.
        for (const name of PALETTES) {
            expect(isLightColor(colors[name][BRAND_SHADE], theme.luminanceThreshold), name).toBe(true);
        }
    });

    it("the dark text is a neutral near-black, not brown", () => {
        const [r, g, b] = [1, 3, 5].map((start) => parseInt(INK.slice(start, start + 2), 16)) as [number, number, number];
        expect(b).toBeGreaterThanOrEqual(r);
        expect(Math.max(r, g, b)).toBeLessThan(0x30);
    });
});

describe.each([
    ["light", LIGHT],
    ["dark", DARK],
] as const)("%s scheme: every variant pairing (WCAG AA)", (scheme, vars) => {
    const textSurfaces = scheme === "light" ? [WHITE, colors.gray[0], colors.gray[1]] : [page, card, raised];

    it.each(PALETTES)("%s: filled (and its hover) carries dark text at 4.5:1", (name) => {
        expect(contrast(INK, v(vars, name, "filled"))).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(INK, v(vars, name, "filled-hover"))).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(PALETTES)("%s: light variant text on its surface and hover", (name) => {
        const text = v(vars, name, "light-color");
        expect(contrast(text, v(vars, name, "light"))).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(text, v(vars, name, "light-hover"))).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(PALETTES)("%s: coloured text, subtle and outline controls on the page and cards", (name) => {
        expect(vars[`--mantine-color-${name}-outline`]).toBe(vars[`--mantine-color-${name}-text`]);
        for (const surface of textSurfaces) {
            expect(contrast(v(vars, name, "text"), surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
        expect(vars[`--mantine-color-${name}-outline-hover`]).toBe(withAlpha(v(vars, name, "text"), HOVER_TINT_ALPHA));
    });

    it.each(PALETTES)("%s: notices (Alert) — title and icon on the panel, and the message text", (name) => {
        const bg = notice(vars, name, "bg");
        expect(contrast(notice(vars, name, "color"), bg)).toBeGreaterThanOrEqual(AA_TEXT);
        // Mantine writes the message in black (light) or white (dark).
        expect(contrast(scheme === "light" ? INK : WHITE, bg)).toBeGreaterThanOrEqual(AA_TEXT);
        if (scheme === "dark") {
            // The coloured edge shows against the panel.
            expect(contrast(notice(vars, name, "border"), bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
        }
    });

    it("anchors, errors and success text", () => {
        for (const surface of textSurfaces) {
            for (const role of ["anchor", "error", "success"]) {
                expect(contrast(resolve(vars[`--mantine-color-${role}`]), surface), role).toBeGreaterThanOrEqual(AA_TEXT);
            }
        }
    });
});

describe("light scheme: the rest of the surfaces", () => {
    const tints = [colors.gray[0], colors.gray[1], ...PALETTES.flatMap((name) => [colors[name][0], colors[name][1]])];

    it("body text and dimmed text (gray.6) on white and on every tint", () => {
        expect(contrast(black, WHITE)).toBeGreaterThanOrEqual(7);
        for (const surface of [WHITE, ...tints]) {
            expect(contrast(black, surface)).toBeGreaterThanOrEqual(7);
            expect(contrast(colors.gray[6], surface), surface).toBeGreaterThanOrEqual(AA_TEXT);
        }
        expect(LIGHT["--mantine-color-placeholder"]).toBe("var(--mantine-color-gray-6)");
    });

    it("tokens (globals.css): accent text on white and the coral tints, secondary, danger and success text on white", () => {
        for (const surface of [WHITE, colors.gray[0], colors.orange[0], colors.orange[1]]) {
            expect(contrast(colors.orange[8], surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
        expect(contrast(colors.gray[7], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(colors.red[7], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(colors.teal[9], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
        // Your own message bubble (orange.1) with dark text.
        expect(contrast(INK, colors.orange[1])).toBeGreaterThanOrEqual(7);
    });

    it("non-text UI at 3:1 on white: input borders, focus ring, stars, ticks, the hero word", () => {
        for (const colour of [colors.gray[5], colors.blue[7], colors.tan[7], colors.teal[8], colors.orange[5]]) {
            expect(contrast(colour, WHITE), colour).toBeGreaterThanOrEqual(AA_NON_TEXT);
        }
    });
});

describe("dark scheme: the charcoal and what sits on it", () => {
    it("body text (dark.0), secondary (dark.1) and dimmed (dark.2) on the page, cards and raised surfaces", () => {
        for (const surface of [page, card, raised]) {
            expect(contrast(dark[0], surface)).toBeGreaterThanOrEqual(7);
            expect(contrast(dark[1], surface)).toBeGreaterThanOrEqual(AA_TEXT);
            expect(contrast(dark[2], surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    it("the brand pastels themselves stand out from the page and cards", () => {
        for (const name of PALETTES.filter((palette) => palette !== "gray")) {
            for (const surface of [page, card]) {
                expect(contrast(colors[name][BRAND_SHADE], surface), name).toBeGreaterThanOrEqual(AA_NON_TEXT);
            }
        }
    });

    it("tokens (globals.css): accent text on the raised accent surface, your own bubble, the others' bubble", () => {
        expect(contrast(colors.orange[DARK_TEXT_SHADE.orange], raised)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(INK, colors.orange[3])).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(dark[0], raised)).toBeGreaterThanOrEqual(7);
        expect(contrast(colors.red[3], page)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(colors.teal[3], page)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("non-text UI at 3:1 on the page and cards: input borders, focus ring, stars, ticks, the brand edge, the hero word", () => {
        for (const surface of [page, card]) {
            for (const colour of [dark[3], colors.blue[4], colors.tan[3], colors.teal[3], colors.orange[3], colors.orange[2]]) {
                expect(contrast(colour, surface), colour).toBeGreaterThanOrEqual(AA_NON_TEXT);
            }
        }
    });

    it("the scale is neutral with at most a slight cool tint, never warm (a warm scale reads as brown next to the coral)", () => {
        for (const shade of dark) {
            const [r, g, b] = [1, 3, 5].map((start) => parseInt(shade.slice(start, start + 2), 16)) as [number, number, number];
            expect(b, shade).toBeGreaterThanOrEqual(r);
            expect(b, shade).toBeGreaterThanOrEqual(g);
            expect(b - r, shade).toBeLessThanOrEqual(16);
        }
    });
});

describe("toasts", () => {
    it.each(PALETTES)("%s: a white icon on the toast colour is 4.5:1", (name) => {
        expect(notificationColor(name)).toBe(colors[name][TEXT_SHADE[name]]);
        expect(contrast(WHITE, notificationColor(name))).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("falls back to the coral", () => {
        expect(notificationColor(undefined)).toBe(colors.orange[TEXT_SHADE.orange]);
        expect(notificationColor("grape")).toBe(colors.orange[TEXT_SHADE.orange]);
    });
});

describe("variantColorResolver", () => {
    const merged = mergeMantineTheme(DEFAULT_THEME, createTheme(theme));

    it("subtle controls use the text shade, with a tint of it on hover", () => {
        expect(variantColorResolver({ color: "teal", theme: merged, variant: "subtle" })).toMatchObject({
            color: "var(--mantine-color-teal-text)",
            hover: "var(--mantine-color-teal-outline-hover)",
        });
    });

    it("transparent controls use the text shade and keep Mantine's hover", () => {
        const result = variantColorResolver({ color: undefined, theme: merged, variant: "transparent" });
        expect(result.color).toBe("var(--mantine-color-orange-text)");
        expect(result.hover).toBe("transparent");
    });

    it("leaves every other variant, explicit shades and non-palette colours to Mantine", () => {
        expect(variantColorResolver({ color: "orange", theme: merged, variant: "filled" })).toMatchObject({
            background: "var(--mantine-color-orange-filled)",
            color: "var(--mantine-color-black)",
        });
        expect(variantColorResolver({ color: "orange.6", theme: merged, variant: "subtle" }).color).toBe("var(--mantine-color-orange-6)");
    });
});

describe("noticeVars (Alert)", () => {
    it("draws the light variant, the default, as a notice panel", () => {
        const expected = {
            root: {
                "--alert-bd": "1px solid var(--iso-red-notice-border)",
                "--alert-bg": "var(--iso-red-notice-bg)",
                "--alert-color": "var(--iso-red-notice-color)",
            },
        };
        expect(noticeVars("red", undefined, "orange")).toEqual(expected);
        expect(noticeVars("red", "light", "orange")).toEqual(expected);
        expect(noticeVars(undefined, undefined, "orange").root).toHaveProperty("--alert-bg", "var(--iso-orange-notice-bg)");
    });

    it("leaves other variants and other colours to Mantine", () => {
        expect(noticeVars("red", "filled", "orange")).toEqual({ root: {} });
        expect(noticeVars("#123456", undefined, "orange")).toEqual({ root: {} });
    });
});
