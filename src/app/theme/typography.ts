import { type MantineTheme, rem } from "@mantine/core";

/**
 * Heading scale: size and weight both step down with the level. h1 and h2 are
 * fluid so page titles do not crowd a phone screen.
 */
export const headings: Partial<MantineTheme["headings"]> = {
    fontWeight: "700",
    sizes: {
        h1: { fontSize: `clamp(${rem(28)}, 1.4rem + 1.5vw, ${rem(36)})`, fontWeight: "700", lineHeight: "1.2" },
        h2: { fontSize: `clamp(${rem(22)}, 1.2rem + 0.8vw, ${rem(26)})`, fontWeight: "700", lineHeight: "1.25" },
        h3: { fontSize: rem(20), fontWeight: "600", lineHeight: "1.3" },
        h4: { fontSize: rem(18), fontWeight: "600", lineHeight: "1.35" },
        h5: { fontSize: rem(16), fontWeight: "600", lineHeight: "1.4" },
        h6: { fontSize: rem(14), fontWeight: "600", lineHeight: "1.45" },
    },
    textWrap: "balance",
};
