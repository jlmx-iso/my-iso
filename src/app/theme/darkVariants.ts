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

/**
 * The colour a dark-mode light variant is tinted with. Gray is the warm
 * light-mode neutral, which reads as brown on the cool dark surfaces, so in
 * dark mode it takes the neutral dark.3 instead.
 */
export function darkTintSource(name: (typeof DARK_TINTED)[number]): string {
    return name === "gray" ? colors.dark[3] : colors[name][6];
}

export const darkLightVariables: Record<string, string> = Object.fromEntries(
    DARK_TINTED.flatMap((name) => [
        [`--mantine-color-${name}-light`, withAlpha(darkTintSource(name), DARK_LIGHT_ALPHA)],
        [`--mantine-color-${name}-light-hover`, withAlpha(darkTintSource(name), DARK_LIGHT_HOVER_ALPHA)],
    ]),
);

/**
 * `color="gray"` in dark mode (text, filled and outline controls, the text
 * on a gray light variant) on the neutral dark scale rather than the warm
 * light-mode gray, which reads as brown there. Filled is dark.4 with a
 * darker hover, as Mantine's own dark gray does; white text on both stays
 * above 4.5:1 (colors.test.ts).
 */
export const darkGrayVariables: Record<string, string> = {
    "--mantine-color-gray-text": "var(--mantine-color-dark-2)",
    "--mantine-color-gray-filled": "var(--mantine-color-dark-4)",
    "--mantine-color-gray-filled-hover": "var(--mantine-color-dark-5)",
    "--mantine-color-gray-light-color": "var(--mantine-color-dark-0)",
    "--mantine-color-gray-outline": "var(--mantine-color-dark-1)",
    "--mantine-color-gray-outline-hover": withAlpha(colors.dark[1], 0.05),
};
