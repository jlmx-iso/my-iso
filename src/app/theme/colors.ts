import { type MantineColorsTuple } from "@mantine/core";

/**
 * Brand palette. Shade 6 of every colour is the "filled" shade and gives at
 * least 4.5:1 against white, so white-on-filled buttons, anchors, outline
 * buttons and coloured text all meet WCAG AA. Light variants pair shade 9
 * text with a shade 1 background (the Mantine 9 defaults). The ratios are
 * asserted in `colors.test.ts`.
 */
const colors = {
    // Replaces Mantine's blue, whose filled shade is 3.6:1 against white.
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
    // Warm neutral. `dimmed` text is gray.6 and stays readable on white and on
    // the tinted surfaces (gray.0/1, orange.0/1, teal.0).
    gray: [
        "#faf7f6",
        "#f2edec",
        "#e5dfde",
        "#d1cac9",
        "#b5adac",
        "#8d8584",
        "#6b6362",
        "#57504f",
        "#423c3b",
        "#2c2827",
    ],
    // Replaces Mantine's green, whose filled shade is 2.3:1 against white.
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
    // Primary: warm coral. Shade 3 is the original brand pastel and is only
    // for decoration (stripes, illustrations), never for text or controls.
    orange: [
        "#fff1ed",
        "#ffe1d9",
        "#fdc3b5",
        "#f6a08b",
        "#ee7f65",
        "#e26345",
        "#c9401d",
        "#ad3516",
        "#8f2c14",
        "#742512",
    ],
    purple: [
        "#f2f1f8",
        "#e0dfeb",
        "#bfbdd8",
        "#9b98c5",
        "#7d78b4",
        "#6a64ab",
        "#5a539f",
        "#4c468b",
        "#413c78",
        "#353163",
    ],
    // Errors and destructive actions: a cooler crimson so it does not read as
    // the brand coral.
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
    // Ratings and tinted notices only (stars, `light` alerts and badges): shade
    // 6 gives 3:1 against white for non-text UI. Not for filled controls: white
    // text on it is below 4.5:1.
    tan: [
        "#fff6e5",
        "#fbe8c4",
        "#f5d596",
        "#eebf66",
        "#e5a93d",
        "#d49220",
        "#b3740d",
        "#946009",
        "#784e08",
        "#5c3c06",
    ],
    // Dark mode surfaces and text: a near-neutral charcoal with a very slight
    // cool tint, so the coral primary stands out rather than reading as
    // brown (the warm gray is for light mode only). 0 text, 1 secondary
    // text, 2 dimmed, 3 input borders and neutral tints, 4 borders, 5 raised
    // surfaces and hover, 6 cards, 7 the page. Shade 5 is a touch darker
    // than an even step so dimmed text keeps 4.5:1 on it (colors.test.ts).
    dark: [
        "#e9ecef",
        "#c9ccd1",
        "#a3a8b0",
        "#7a8089",
        "#4b5058",
        "#373a41",
        "#2c2f35",
        "#212328",
        "#18191d",
        "#111214",
    ],
    // Accent.
    teal: [
        "#e7faf7",
        "#cff1ed",
        "#a6dfd9",
        "#7dccc4",
        "#55b3aa",
        "#369b92",
        "#1d7a72",
        "#17665f",
        "#12534e",
        "#0d403c",
    ],
} satisfies Record<string, MantineColorsTuple>;

/** Body text: a warm near-black. */
export const black = "#201c1b";

export default colors;
