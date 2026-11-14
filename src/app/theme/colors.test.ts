import { readFileSync } from "node:fs";
import path from "node:path";

import { createTheme, DEFAULT_THEME, isLightColor, mergeMantineTheme } from "@mantine/core";
import { describe, expect, it } from "vitest";

import colors, { black } from "./colors";
import theme from "./index";
import {
    BRAND_SHADE,
    DARK_PANEL_LIGHT,
    DARK_OUTLINE_BORDER_ALPHA,
    DARK_TEXT_SHADE,
    DARK_TINT_ALPHA,
    DARK_TINT_HOVER_ALPHA,
    HOVER_TINT_ALPHA,
    INK,
    LIGHT_TEXT,
    noticeVars,
    notificationColor,
    outlineButtonVars,
    PALETTES,
    schemeVariables,
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
        expect(dark.slice(2, 8)).toEqual(["#aeb8c9", "#8d9ab0", "#283851", "#1f2d45", "#172338", "#111a2b"]);
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

    it("body text (dark.0), secondary (dark.1), dimmed (dark.2) and faint (dark.3) on the page, cards and raised surfaces", () => {
        for (const surface of [page, card, raised]) {
            expect(contrast(dark[0], surface)).toBeGreaterThanOrEqual(7);
            expect(contrast(dark[1], surface)).toBeGreaterThanOrEqual(AA_TEXT);
            expect(contrast(dark[2], surface)).toBeGreaterThanOrEqual(AA_TEXT);
            // Faint was lifted from the mock's #8390a6 (4.3:1 on raised).
            expect(contrast(dark[3], surface), surface).toBeGreaterThanOrEqual(AA_TEXT);
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

    it.each(PALETTES)("%s: subtle and outline controls on hover: the text on its own tint, composited over the page and cards", (name) => {
        const text = mantine(vars, name, "text");
        for (const surface of surfaces) {
            const hover = resolve(vars[`--mantine-color-${name}-outline-hover`], surface);
            expect(contrast(text, hover), surface).toBeGreaterThanOrEqual(AA_TEXT);
        }
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
        // Teal and sand text use their ink: shade 9 is under 4.5:1 on its own hover tint.
        expect(LIGHT_TEXT.teal).toBe(TINT_INK.teal);
        expect(LIGHT_TEXT.tan).toBe(TINT_INK.tan);
        for (const name of PALETTES) {
            expect(LIGHT[`--mantine-color-${name}-light`]).toBe(`var(--mantine-color-${name}-1)`);
            expect(LIGHT[`--mantine-color-${name}-light-color`]).toBe(TINT_INK[name]);
            expect(LIGHT[`--mantine-color-${name}-text`]).toBe(LIGHT_TEXT[name]);
        }
    });

    it("dark mode: chips are the pastel at a low alpha with the pastel as text; gray is the navy", () => {
        const tinted = PALETTES.filter(
            (palette): palette is Exclude<(typeof PALETTES)[number], "gray"> =>
                palette !== "gray" && !(DARK_PANEL_LIGHT as readonly string[]).includes(palette),
        );
        for (const name of tinted) {
            expect(DARK[`--mantine-color-${name}-light`]).toBe(withAlpha(colors[name][BRAND_SHADE], DARK_TINT_ALPHA));
            expect(DARK[`--mantine-color-${name}-light-hover`]).toBe(withAlpha(colors[name][BRAND_SHADE], DARK_TINT_HOVER_ALPHA));
            expect(DARK[`--mantine-color-${name}-text`]).toBe(`var(--mantine-color-${name}-${DARK_TEXT_SHADE[name]})`);
        }
        // Coral and red: a raised navy panel with the colour as text (a low-alpha coral over navy reads brown).
        expect(DARK_PANEL_LIGHT).toEqual(["orange", "red"]);
        for (const name of DARK_PANEL_LIGHT) {
            expect(DARK[`--mantine-color-${name}-light`]).toBe("var(--mantine-color-dark-5)");
            expect(DARK[`--mantine-color-${name}-light-hover`]).toBe("var(--mantine-color-dark-4)");
            expect(DARK[`--mantine-color-${name}-light-color`]).toBe(`var(--mantine-color-${name}-3)`);
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

/**
 * The `--iso-*` role tokens and the focus ring, read from globals.css:
 * the plain `:root` blocks for light mode, with the dark block on top.
 */
const GLOBALS = readFileSync(path.resolve(import.meta.dirname, "../../styles/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(body: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        if (name && value) result[name] = value.trim();
    }
    return result;
}

const LIGHT_TOKENS = Object.assign({}, ...[...GLOBALS.matchAll(/(?:^|\n)\s*:root\s*\{([^}]*)\}/g)].map(([, body]) => declarations(body!))) as Record<string, string>;
const DARK_BLOCK = /:root\[data-mantine-color-scheme="dark"\]\s*\{([^}]*)\}/.exec(GLOBALS)?.[1] ?? "";
const DARK_TOKENS = { ...LIGHT_TOKENS, ...declarations(DARK_BLOCK) };

const TOKENS = { dark: DARK_TOKENS, light: LIGHT_TOKENS } as const;
const SCHEME_VARS = { dark: DARK, light: LIGHT } as const;

/** A token (or any value) as the opaque colour it paints in `scheme`, over `under` where it is translucent. */
function token(scheme: "light" | "dark", value: string, under?: string): string {
    const name = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
    if (name && name in TOKENS[scheme]) return token(scheme, TOKENS[scheme][name]!, under);
    if (name && name in SCHEME_VARS[scheme]) return token(scheme, SCHEME_VARS[scheme][name]!, under);
    return resolve(value, under);
}

const SURFACES = {
    dark: [page, card, raised],
    light: [WHITE, colors.gray[0], colors.gray[1]],
} as const;

describe.each(["light", "dark"] as const)("role tokens (globals.css), %s scheme", (scheme) => {
    const t = (name: string, under?: string) => token(scheme, `var(${name})`, under);

    it("every token the tests rely on is defined in the stylesheet", () => {
        for (const name of ["--iso-info", "--iso-danger-text", "--iso-banner", "--iso-tile-bg", "--iso-chart-bar", "--iso-pro-border", "--focus-ring-color"]) {
            expect(TOKENS[scheme], name).toHaveProperty(name);
        }
    });

    it("text tokens read at 4.5:1 on the page and cards: secondary, accent (links), danger, success, information", () => {
        for (const name of ["--iso-text-secondary", "--iso-accent-text", "--iso-danger-text", "--iso-success-text", "--iso-info"]) {
            for (const surface of SURFACES[scheme]) {
                expect(contrast(t(name), surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(AA_TEXT);
            }
        }
    });

    it("non-text tokens at 3:1 on the page and cards: input borders, success ticks, stars, chart bars, the hero word", () => {
        const surfaces = scheme === "light" ? [WHITE] : [page, card];
        for (const name of ["--iso-input-border", "--iso-success-icon", "--iso-rating", "--iso-chart-bar", "--iso-hero-from", "--iso-hero-to"]) {
            for (const surface of surfaces) {
                expect(contrast(t(name), surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(AA_NON_TEXT);
            }
        }
    });

    it("the keyboard focus ring is 3:1 on every surface it can sit on", () => {
        const surfaces =
            scheme === "light"
                ? [WHITE, colors.gray[0], colors.gray[1], ...PALETTES.map((name) => colors[name][1])]
                : [page, card, raised, dark[4]];
        for (const surface of surfaces) {
            expect(contrast(t("--focus-ring-color"), surface), surface).toBeGreaterThanOrEqual(AA_NON_TEXT);
        }
    });

    it("pairs: the date tile, your own bubble, unread counts, accent surfaces", () => {
        const pairs: [string, string][] = [
            ["--iso-tile-month", "--iso-tile-bg"],
            ["--iso-tile-day", "--iso-tile-bg"],
            ["--iso-bubble-own-text", "--iso-bubble-own"],
            ["--iso-unread-text", "--iso-unread-bg"],
            ["--iso-accent-text", "--iso-accent-surface"],
            ["--iso-accent-text", "--iso-accent-surface-strong"],
        ];
        for (const [text, surface] of pairs) {
            expect(contrast(t(text), t(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(AA_TEXT);
        }
        const dimmed = scheme === "light" ? colors.gray[6] : dark[2];
        expect(contrast(dimmed, t("--iso-tile-bg"))).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(dimmed, t("--iso-accent-surface-strong"))).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(dimmed, t("--iso-surface-muted"))).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("the profile banner: the brand pastels, with body text readable over every stop", () => {
        const banner = TOKENS[scheme]["--iso-banner"]!;
        const base = scheme === "light" ? WHITE : dark[6];
        const text = scheme === "light" ? black : dark[0];
        const stops = [...banner.matchAll(/(var\(--mantine-color-[a-z]+-\d\)|rgba\([^)]*\))/g)].map(([stop]) => stop);
        expect(stops.length).toBeGreaterThanOrEqual(3);
        for (const stop of stops) {
            expect(contrast(text, token(scheme, stop, base)), stop).toBeGreaterThanOrEqual(7);
        }
        if (scheme === "dark") {
            // The pastels themselves at a low alpha, over a card (not brick and olive).
            expect(banner).toContain(withAlpha(colors.orange[3], 0.22));
            expect(banner).toContain("var(--mantine-color-dark-6)");
        }
    });

    it("the roles: salmon fills carry dark text, other members' and your own avatars carry dark text", () => {
        for (const pastel of [colors.orange[3], colors.teal[3], colors.purple[3], colors.tan[3]]) {
            expect(contrast(INK, pastel)).toBeGreaterThanOrEqual(AA_TEXT);
        }
    });
});

describe("toasts", () => {
    it.each(PALETTES)("%s: a white icon on the toast colour is 4.5:1", (name) => {
        expect(notificationColor(name)).toBe(LIGHT_TEXT[name]);
        expect(contrast(WHITE, notificationColor(name))).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("falls back to the coral", () => {
        expect(notificationColor(undefined)).toBe(LIGHT_TEXT.orange);
        expect(notificationColor("grape")).toBe(LIGHT_TEXT.orange);
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
