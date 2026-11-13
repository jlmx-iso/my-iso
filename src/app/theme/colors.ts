import { type MantineColorsTuple } from "@mantine/core";

/**
 * Brand palette: the original ISO colours. Shade 3 of each brand colour is
 * the brand pastel (coral #e98f7b, sand #e9bd7b, teal #95cfc9, lavender
 * #9b98c5) and is the filled shade in both schemes. Contrast comes from
 * dark text on the pastel (`INK`, variants.ts), not from darker colours;
 * coloured text on white uses a darker shade of the same scale
 * (`TEXT_SHADE`, variants.ts). Every pairing is asserted in
 * `colors.test.ts`.
 */
const colors = {
    // The keyboard focus ring only: information is teal.
    blue: [
        "#eef5fd",
        "#dbe9fa",
        "#b7d2f3",
        "#8fb8ea",
        "#6a9fe0",
        "#4a87d3",
        "#1f66b8",
        "#19579d",
        "#144780",
        "#103965",
    ],
    // Neutral gray (light mode). Shade 6 is `dimmed` text and stays at
    // 4.5:1 on white and on the tinted surfaces (gray.0/1, orange.0/1,
    // teal.0, purple.0).
    gray: [
        "#f8f9fa",
        "#eef0f2",
        "#e1e3e6",
        "#ccced2",
        "#adb0b5",
        "#878a90",
        "#5f6268",
        "#4f5257",
        "#3d3f43",
        "#2a2b2e",
    ],
    green: [
        "#ebf9ef",
        "#d5f1dd",
        "#aee2bc",
        "#84d199",
        "#5bbd77",
        "#3ba55b",
        "#1f7f3f",
        "#196b35",
        "#14572b",
        "#104422",
    ],
    // Primary: the original coral. Shade 3 (#e98f7b) is the brand salmon:
    // the brand and the main action only.
    orange: [
        "#ffede9",
        "#fcdcd3",
        "#f2b7a9",
        "#e98f7b",
        "#e16e53",
        "#dd583a",
        "#dc4d2c",
        "#c43d1f",
        "#af351a",
        "#9a2a13",
    ],
    // Lavender: Discover and people (other members, matches, icebreakers).
    purple: [
        "#f2f1f8",
        "#e0dfeb",
        "#bfbdd8",
        "#9b98c5",
        "#7d78b4",
        "#6a64ab",
        "#615aa8",
        "#514b93",
        "#474384",
        "#3c3975",
    ],
    // Errors and destructive actions: a crimson distinct from the coral.
    red: [
        "#fff0f1",
        "#ffdfe1",
        "#ffc2c7",
        "#ff9aa2",
        "#f8707b",
        "#ec4a58",
        "#d02b3b",
        "#b32232",
        "#941c2a",
        "#761722",
    ],
    // Sand: Pro and premium, ratings, and notices that ask for attention.
    tan: [
        "#fff5e4",
        "#f1dbb9",
        "#f2d4a9",
        "#e9bd7b",
        "#e2a953",
        "#de9c3b",
        "#dc962c",
        "#c3821e",
        "#ae7317",
        // The original #986209 is 4.499:1 on gray.1, a hair under AA as
        // text; one step darker, the same colour to the eye.
        "#956008",
    ],
    // Dark mode: deep navy, which sits with the salmon instead of against it
    // (a near-black made the salmon look harsh). 0 text, 1 secondary text,
    // 2 dimmed, 3 faint text and input borders, 4 borders, 5 raised surfaces
    // and hover, 6 cards, 7 the page, 8 and 9 deeper still.
    dark: [
        "#ecf0f6",
        "#cdd5e2",
        "#aeb8c9",
        "#8390a6",
        "#283851",
        "#1f2d45",
        "#172338",
        "#111a2b",
        "#0c1322",
        "#070c17",
    ],
    // Teal: information, status, secondary actions and success.
    teal: [
        "#e6fcf9",
        "#d9f1ef",
        "#b9e0dc",
        "#95cfc9",
        "#77c0b8",
        "#62b7ae",
        "#56b2a9",
        "#449c93",
        "#368b83",
        "#1f7972",
    ],
} satisfies Record<string, MantineColorsTuple>;

/** Body text, and the text on every pastel fill: a neutral near-black. */
export const black = "#1b1c1f";

export default colors;
