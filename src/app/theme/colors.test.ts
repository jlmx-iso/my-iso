import { createTheme, DEFAULT_THEME, isLightColor, mergeMantineTheme } from "@mantine/core";
import { describe, expect, it } from "vitest";

import colors, { black } from "./colors";
import theme from "./index";
import {
    BRAND_SHADE,
    DARK_OUTLINE_BORDER_ALPHA,
    DARK_TEXT_SHADE,
    DARK_TINT_ALPHA,
    DARK_TINT_HOVER_ALPHA,
    HOVER_TINT_ALPHA,
    INK,
    noticeVars,
    notificationColor,
    outlineButtonVars,
    PALETTES,
    schemeVariables,
    TEXT_SHADE,
    TINT_INK,
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

const rgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];

const WHITE = "#ffffff";
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;
const { dark } = colors;
const page = dark[7];
const card = dark[6];
const raised = dark[5];

/**
 * The opaque colour a variable value paints over `under`: a palette
 * variable, black, a hex, or an `rgba()` tint composited over `under`.
 */
function resolve(value: string | undefined, under = WHITE): string {
    if (value === "var(--mantine-color-black)") return black;
    if (value && /^#[0-9a-f]{6}$/.test(value)) return value;
    const tint = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value ?? "");
    if (tint) {
        const [, r, g, b, alpha] = tint as unknown as [string, string, string, string, string];
        const hex = `#${[r, g, b].map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}`;
        return over(hex, Number(alpha), under);
    }
    const match = /^var\(--mantine-color-([a-z]+)-(\d)\)$/.exec(value ?? "");
    if (!match) throw new Error(`not a palette colour: ${value}`);
    const [, name, index] = match as unknown as [string, keyof typeof colors, string];
    return colors[name][Number(index)]!;
}

const LIGHT = schemeVariables("light");
const DARK = schemeVariables("dark");
const mantine = (vars: Record<string, string>, name: string, role: string, under?: string) =>
    resolve(vars[`--mantine-color-${name}-${role}`], under);
const iso = (vars: Record<string, string>, name: string, role: string, under?: string) =>
    resolve(vars[`--iso-${name}-${role}`], under);

describe("the brand is the original ISO palette", () => {
    it("pins the brand pastels to the original colours", () => {
        // Within a hair (2 per channel) of the original hex, so the hue cannot drift again.
        const near = (hex: string, original: string) => rgb(hex).every((channel, i) => Math.abs(channel - rgb(original)[i]!) <= 2);
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
        const [r, g, b] = rgb(INK);
        expect(b).toBeGreaterThanOrEqual(r);
        expect(Math.max(r, g, b)).toBeLessThan(0x30);
    });
});

describe("dark mode is deep navy", () => {
    it("keeps the approved surfaces in their roles: 0 text, 2 dimmed, 3 faint, 4 borders, 5 raised, 6 cards, 7 the page", () => {
        expect(dark.slice(2, 8)).toEqual(["#aeb8c9", "#8390a6", "#283851", "#1f2d45", "#172338", "#111a2b"]);
        expect(dark[0]).toBe("#ecf0f6");
        // 8 and 9 deeper than the page.
        expect(luminance(dark[8])).toBeLessThan(luminance(page));
        expect(luminance(dark[9])).toBeLessThan(luminance(dark[8]));
    });

    it("every shade is navy: blue clearly dominant, then green, then red (not purple, not gray)", () => {
        for (const shade of dark) {
            const [r, g, b] = rgb(shade);
            expect(b, shade).toBeGreaterThan(g);
            // Red below green: a red-leaning blue is purple.
            expect(g, shade).toBeGreaterThanOrEqual(r);
            expect(b - r, shade).toBeGreaterThanOrEqual(10);
        }
        // The surfaces carry the hue (text is near white).
        for (const shade of dark.slice(4)) {
            const [r, , b] = rgb(shade);
            expect(b - r, shade).toBeGreaterThanOrEqual(16);
        }
    });

    it("body text (dark.0), secondary (dark.1) and dimmed (dark.2) on the page, cards and raised surfaces; faint (dark.3) on the page and cards", () => {
        for (const surface of [page, card, raised]) {
            expect(contrast(dark[0], surface)).toBeGreaterThanOrEqual(7);
            expect(contrast(dark[1], surface)).toBeGreaterThanOrEqual(AA_TEXT);
            expect(contrast(dark[2], surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
        for (const surface of [page, card]) {
            expect(contrast(dark[3], surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    it("the pastels stand out from the page and cards, as measured on the mock", () => {
        for (const name of PALETTES.filter((palette) => palette !== "gray")) {
            for (const surface of [page, card]) {
                expect(contrast(colors[name][BRAND_SHADE], surface), name).toBeGreaterThanOrEqual(AA_TEXT);
            }
        }
        expect(contrast(colors.orange[3], card)).toBeGreaterThanOrEqual(6.5);
        expect(contrast(colors.orange[3], raised)).toBeGreaterThanOrEqual(5.7);
        expect(contrast(colors.purple[2], card)).toBeGreaterThanOrEqual(8.6);
    });
});

describe.each([
    ["light", LIGHT, [WHITE, colors.gray[0], colors.gray[1]]],
    ["dark", DARK, [page, card, raised]],
] as const)("%s scheme: every variant pairing (WCAG AA)", (scheme, vars, surfaces) => {
    it.each(PALETTES)("%s: filled (and its hover) carries dark text at 4.5:1", (name) => {
        expect(contrast(INK, mantine(vars, name, "filled"))).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(INK, mantine(vars, name, "filled-hover"))).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(PALETTES)("%s: light variant (chips, badges) text on its tint and hover, wherever the tint sits", (name) => {
        const text = mantine(vars, name, "light-color");
        for (const under of surfaces) {
            expect(contrast(text, mantine(vars, name, "light", under)), under).toBeGreaterThanOrEqual(AA_TEXT);
            expect(contrast(text, mantine(vars, name, "light-hover", under)), under).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });

    it.each(PALETTES)("%s: coloured text, subtle and outline controls on the page and cards", (name) => {
        expect(vars[`--mantine-color-${name}-outline`]).toBe(vars[`--mantine-color-${name}-text`]);
        for (const surface of surfaces) {
            expect(contrast(mantine(vars, name, "text"), surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
        expect(vars[`--mantine-color-${name}-outline-hover`]).toBe(withAlpha(mantine(vars, name, "text"), HOVER_TINT_ALPHA));
    });

    it.each(PALETTES)("%s: notices (Alert) — title and icon on the panel, and the message text", (name) => {
        const bg = iso(vars, name, "notice-bg");
        expect(contrast(iso(vars, name, "notice-color"), bg)).toBeGreaterThanOrEqual(AA_TEXT);
        // Mantine writes the message in black (light) or white (dark).
        expect(contrast(scheme === "light" ? INK : WHITE, bg)).toBeGreaterThanOrEqual(AA_TEXT);
        if (scheme === "dark") {
            expect(contrast(iso(vars, name, "notice-border"), bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
        }
    });

    it("anchors, errors and success text", () => {
        for (const surface of surfaces) {
            for (const role of ["anchor", "error", "success"]) {
                expect(contrast(resolve(vars[`--mantine-color-${role}`]), surface), role).toBeGreaterThanOrEqual(AA_TEXT);
            }
        }
    });
});

describe("variant rules", () => {
    it("light mode: the tints carry the mock's inks", () => {
        expect(TINT_INK).toMatchObject({ orange: "#8f3016", purple: "#433e80", tan: "#7a4e05", teal: "#17625d" });
        for (const name of PALETTES) {
            expect(LIGHT[`--mantine-color-${name}-light`]).toBe(`var(--mantine-color-${name}-1)`);
            expect(LIGHT[`--mantine-color-${name}-light-color`]).toBe(TINT_INK[name]);
            expect(LIGHT[`--mantine-color-${name}-text`]).toBe(`var(--mantine-color-${name}-${TEXT_SHADE[name]})`);
        }
    });

    it("dark mode: chips are the pastel at a low alpha with the pastel as text; gray is the navy", () => {
        for (const name of PALETTES.filter((palette) => palette !== "gray")) {
            expect(DARK[`--mantine-color-${name}-light`]).toBe(withAlpha(colors[name][BRAND_SHADE], DARK_TINT_ALPHA));
            expect(DARK[`--mantine-color-${name}-light-hover`]).toBe(withAlpha(colors[name][BRAND_SHADE], DARK_TINT_HOVER_ALPHA));
            expect(DARK[`--mantine-color-${name}-text`]).toBe(`var(--mantine-color-${name}-${DARK_TEXT_SHADE[name]})`);
        }
        expect(DARK["--mantine-color-gray-light"]).toBe("var(--mantine-color-dark-4)");
        expect(DARK["--mantine-color-gray-filled"]).toBe("var(--mantine-color-dark-2)");
    });

    it("secondary (outline) buttons: a pastel edge that shows on the navy, the colour's text inside", () => {
        expect(LIGHT["--iso-teal-outline-border"]).toBe("var(--mantine-color-teal-3)");
        expect(LIGHT["--iso-gray-outline-border"]).toBe("var(--mantine-color-gray-5)");
        expect(DARK["--iso-teal-outline-border"]).toBe(withAlpha(colors.teal[3], DARK_OUTLINE_BORDER_ALPHA));
        for (const name of PALETTES) {
            for (const surface of [page, card]) {
                expect(contrast(iso(DARK, name, "outline-border", surface), surface), name).toBeGreaterThanOrEqual(AA_NON_TEXT);
            }
        }
    });
});

describe("role tokens (globals.css)", () => {
    it("salmon is the brand and the main action: the active nav pill and primary buttons carry dark text, links read", () => {
        expect(contrast(INK, colors.orange[3])).toBeGreaterThanOrEqual(7);
        expect(contrast(colors.orange[8], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(colors.orange[3], card)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("teal is information: event icons and comment actions, unread counts and your own avatar", () => {
        // --iso-info is teal's text colour: teal.9 on white, the pastel on the navy.
        expect(contrast(colors.teal[9], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
        for (const surface of [page, card, raised]) {
            expect(contrast(colors.teal[3], surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
        // --iso-unread-bg and an avatar's initials: dark text on the pastel.
        expect(contrast(INK, colors.teal[3])).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("lavender is people: other members' avatars carry dark text; icebreakers are its chip", () => {
        expect(contrast(INK, colors.purple[3])).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("date tiles: the coral tint with its ink on white, a raised navy panel with a salmon month in dark mode", () => {
        // Light: month, day, weekday on orange.1.
        expect(contrast(TINT_INK.orange, colors.orange[1])).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(INK, colors.orange[1])).toBeGreaterThanOrEqual(7);
        expect(contrast(colors.gray[6], colors.orange[1])).toBeGreaterThanOrEqual(AA_TEXT);
        // Dark: on dark.5, edged with dark.4.
        expect(contrast(colors.orange[3], raised)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(dark[0], raised)).toBeGreaterThanOrEqual(7);
        expect(contrast(dark[2], raised)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("message bubbles: yours is coral with dark text, theirs a neutral surface", () => {
        expect(contrast(INK, colors.orange[1])).toBeGreaterThanOrEqual(7);
        expect(contrast(INK, colors.orange[3])).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(dark[0], raised)).toBeGreaterThanOrEqual(7);
    });

    it("light mode surfaces: body and dimmed text on white and on every tint", () => {
        const tints = [colors.gray[0], colors.gray[1], ...PALETTES.flatMap((name) => [colors[name][0], colors[name][1]])];
        for (const surface of [WHITE, ...tints]) {
            expect(contrast(black, surface)).toBeGreaterThanOrEqual(7);
            expect(contrast(colors.gray[6], surface), surface).toBeGreaterThanOrEqual(AA_TEXT);
        }
        expect(LIGHT["--mantine-color-placeholder"]).toBe("var(--mantine-color-gray-6)");
        for (const surface of [WHITE, colors.gray[0], colors.orange[0], colors.orange[1]]) {
            expect(contrast(colors.orange[8], surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
        expect(contrast(colors.gray[7], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(colors.red[7], WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("non-text UI at 3:1: input borders, focus ring, stars, ticks, the brand edge, the hero word", () => {
        for (const colour of [colors.gray[5], colors.blue[7], colors.tan[7], colors.teal[8], colors.orange[5]]) {
            expect(contrast(colour, WHITE), colour).toBeGreaterThanOrEqual(AA_NON_TEXT);
        }
        for (const surface of [page, card]) {
            for (const colour of [dark[3], colors.blue[4], colors.tan[3], colors.teal[3], colors.orange[3], colors.orange[2]]) {
                expect(contrast(colour, surface), colour).toBeGreaterThanOrEqual(AA_NON_TEXT);
            }
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

describe("component vars", () => {
    it("Alert: the light variant, the default, is a notice panel", () => {
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
        expect(noticeVars("red", "filled", "orange")).toEqual({ root: {} });
        expect(noticeVars("#123456", undefined, "orange")).toEqual({ root: {} });
    });

    it("Button: an outline button takes the softer edge; other variants and colours are Mantine's", () => {
        expect(outlineButtonVars("teal", "outline", "orange")).toEqual({ root: { "--button-bd": "1px solid var(--iso-teal-outline-border)" } });
        expect(outlineButtonVars(undefined, "outline", "orange").root).toHaveProperty("--button-bd", "1px solid var(--iso-orange-outline-border)");
        expect(outlineButtonVars("teal", "filled", "orange")).toEqual({ root: {} });
        expect(outlineButtonVars("teal", undefined, "orange")).toEqual({ root: {} });
        expect(outlineButtonVars("#123456", "outline", "orange")).toEqual({ root: {} });
    });
});
