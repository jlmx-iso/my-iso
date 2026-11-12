import colors from "./colors";

/** `#rrggbb` at an opacity, as `rgba(...)`. */
export function withAlpha(hex: string, alpha: number): string {
    const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * In dark mode Mantine's "light" variant surface (badges, light buttons,
 * the active nav item) is shade 9 darkened by half: nearly black, so a
 * light badge disappears into the page. A translucent shade 6 instead,
 * visible on the page and on cards (asserted in colors.test.ts).
 */
export const DARK_LIGHT_ALPHA = 0.2;
export const DARK_LIGHT_HOVER_ALPHA = 0.28;
// gray and green too: "Your event" and "Past event" badges and gray
// ThemeIcons (empty states) were near-black blobs.
export const DARK_TINTED = ["orange", "teal", "red", "blue", "purple", "gray", "green"] as const;

export const darkLightVariables: Record<string, string> = Object.fromEntries(
    DARK_TINTED.flatMap((name) => [
        [`--mantine-color-${name}-light`, withAlpha(colors[name][6], DARK_LIGHT_ALPHA)],
        [`--mantine-color-${name}-light-hover`, withAlpha(colors[name][6], DARK_LIGHT_HOVER_ALPHA)],
    ]),
);
