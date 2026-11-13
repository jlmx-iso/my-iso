import { defaultVariantColorsResolver, type VariantColorsResolver } from "@mantine/core";

import colors, { black } from "./colors";

/**
 * How the palette maps onto Mantine's variants. The brand colours stay the
 * original pastels; contrast comes from the text on them:
 *
 * - filled: the brand pastel (shade 3) in both schemes, with `INK` text
 *   (theme `autoContrast`); hover is the lighter shade 2.
 * - light: shade 1 with `INK` text on white. In dark mode the pastel itself
 *   (shade 3, hover 2) with `INK` text: a clear brand surface, not a faint
 *   tint on the charcoal.
 * - text, subtle, transparent and outline: the colour as text, at
 *   `TEXT_SHADE` (light) or `DARK_TEXT_SHADE` on the charcoal.
 * - notices (Alert): the light surface on white; in dark mode a raised
 *   charcoal panel with a coloured title, icon and edge.
 * - gray is neutral: light gray in light mode, the charcoal in dark mode.
 *
 * Every pairing is asserted in colors.test.ts.
 */

/** Text on every pastel fill, and body text in light mode. */
export const INK = black;

/** The brand pastel: the filled shade in both schemes. */
export const BRAND_SHADE = 3;

export const PALETTES = ["orange", "tan", "teal", "purple", "red", "blue", "green", "gray"] as const;
export type Palette = (typeof PALETTES)[number];
type Brand = Exclude<Palette, "gray">;

/** Coloured text on white and on the light tints. */
export const TEXT_SHADE: Record<Palette, 7 | 8 | 9> = {
    blue: 7,
    gray: 7,
    green: 7,
    orange: 8,
    purple: 7,
    red: 7,
    tan: 9,
    teal: 9,
};

/** Coloured text on the dark page, cards and raised panels. */
export const DARK_TEXT_SHADE: Record<Brand, 2 | 3> = {
    blue: 3,
    green: 3,
    orange: 3,
    // Lavender's pastel is 4.2:1 on a raised panel; shade 2 reads.
    purple: 2,
    red: 3,
    tan: 3,
    teal: 3,
};

/** Hover tint behind subtle and outline controls: alpha of the text colour. */
export const HOVER_TINT_ALPHA = 0.12;

/** `#rrggbb` at an opacity, as `rgba(...)`. */
export function withAlpha(hex: string, alpha: number): string {
    const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const shade = (name: string, index: number) => `var(--mantine-color-${name}-${index})`;
const INK_VAR = "var(--mantine-color-black)";

type Roles = {
    filled: string;
    filledHover: string;
    light: string;
    lightHover: string;
    lightColor: string;
    text: string;
    textHex: string;
    noticeBg: string;
    noticeColor: string;
    noticeBorder: string;
};

function lightRoles(name: Palette): Roles {
    const text = TEXT_SHADE[name];
    return {
        filled: shade(name, BRAND_SHADE),
        filledHover: shade(name, 2),
        light: shade(name, 1),
        lightHover: shade(name, 2),
        lightColor: INK_VAR,
        noticeBg: shade(name, 1),
        noticeBorder: "transparent",
        noticeColor: INK_VAR,
        text: shade(name, text),
        textHex: colors[name][text],
    };
}

function darkRoles(name: Palette): Roles {
    if (name === "gray") {
        return {
            filled: shade("dark", 2),
            filledHover: shade("dark", 1),
            light: shade("dark", 5),
            lightHover: shade("dark", 4),
            lightColor: shade("dark", 0),
            noticeBg: shade("dark", 5),
            noticeBorder: shade("dark", 2),
            noticeColor: shade("dark", 1),
            text: shade("dark", 2),
            textHex: colors.dark[2],
        };
    }
    const text = DARK_TEXT_SHADE[name];
    return {
        filled: shade(name, BRAND_SHADE),
        filledHover: shade(name, 2),
        light: shade(name, BRAND_SHADE),
        lightHover: shade(name, 2),
        lightColor: INK_VAR,
        noticeBg: shade("dark", 5),
        noticeBorder: shade(name, text),
        noticeColor: shade(name, text),
        text: shade(name, text),
        textHex: colors[name][text],
    };
}

function toVariables(name: Palette, roles: Roles): Record<string, string> {
    const prefix = `--mantine-color-${name}`;
    return {
        [`${prefix}-filled`]: roles.filled,
        [`${prefix}-filled-hover`]: roles.filledHover,
        [`${prefix}-light`]: roles.light,
        [`${prefix}-light-hover`]: roles.lightHover,
        [`${prefix}-light-color`]: roles.lightColor,
        [`${prefix}-text`]: roles.text,
        [`${prefix}-outline`]: roles.text,
        [`${prefix}-outline-hover`]: withAlpha(roles.textHex, HOVER_TINT_ALPHA),
        [`--iso-${name}-notice-bg`]: roles.noticeBg,
        [`--iso-${name}-notice-color`]: roles.noticeColor,
        [`--iso-${name}-notice-border`]: roles.noticeBorder,
    };
}

/** Every palette's variant variables for `scheme`, plus the scheme-wide roles. */
export function schemeVariables(scheme: "light" | "dark"): Record<string, string> {
    const roles = scheme === "light" ? lightRoles : darkRoles;
    const perPalette = Object.assign({}, ...PALETTES.map((name) => toVariables(name, roles(name)))) as Record<string, string>;
    const shared: Record<string, string> =
        scheme === "light"
            ? {
                  "--mantine-color-anchor": shade("orange", TEXT_SHADE.orange),
                  "--mantine-color-error": shade("red", TEXT_SHADE.red),
                  // One shade darker than Mantine's default: 4.5:1 against white.
                  "--mantine-color-placeholder": shade("gray", 6),
                  "--mantine-color-success": shade("teal", TEXT_SHADE.teal),
              }
            : {
                  "--mantine-color-anchor": shade("orange", DARK_TEXT_SHADE.orange),
                  "--mantine-color-error": shade("red", DARK_TEXT_SHADE.red),
                  "--mantine-color-success": shade("teal", DARK_TEXT_SHADE.teal),
              };
    return { ...perPalette, ...shared };
}

function paletteOf(color: string): Palette | null {
    return (PALETTES as readonly string[]).includes(color) ? (color as Palette) : null;
}

/**
 * Mantine's resolver, except that subtle and transparent controls use the
 * colour's text shade (Mantine uses the light variant's text colour, which
 * here is `INK` for the pastel surfaces and would vanish on the dark page),
 * and a subtle control's hover is a tint of that text colour.
 */
export const variantColorResolver: VariantColorsResolver = (input) => {
    const color = input.color ?? input.theme.primaryColor;
    const base = defaultVariantColorsResolver({ ...input, color });
    const name = paletteOf(color);
    if (!name || (input.variant !== "subtle" && input.variant !== "transparent")) return base;
    return {
        ...base,
        color: `var(--mantine-color-${name}-text)`,
        hover: input.variant === "subtle" ? `var(--mantine-color-${name}-outline-hover)` : base.hover,
    };
};

/** A toast's icon and edge: the colour's text shade, so a white icon on it is at least 4.5:1. */
export function notificationColor(color: string | undefined): string {
    const name = paletteOf(color ?? "orange") ?? "orange";
    return colors[name][TEXT_SHADE[name]];
}

/** Alert's light (default) variant as a notice panel; other variants as Mantine draws them. */
export function noticeVars(color: string | undefined, variant: string | undefined, primaryColor: string) {
    const name = paletteOf(color ?? primaryColor);
    if (!name || (variant !== undefined && variant !== "light")) return { root: {} };
    return {
        root: {
            "--alert-bd": `1px solid var(--iso-${name}-notice-border)`,
            "--alert-bg": `var(--iso-${name}-notice-bg)`,
            "--alert-color": `var(--iso-${name}-notice-color)`,
        },
    };
}
