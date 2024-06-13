import { rem, type MantineTheme } from "@mantine/core";

export const headings: Partial<MantineTheme["headings"]> = {
    sizes: {
        h1: { fontSize: rem(36), lineHeight: rem(48), fontWeight: "700" },
        h2: { fontSize: rem(32), lineHeight: rem(36), fontWeight: "500" },
        h3: { fontSize: rem(20), lineHeight: rem(24), fontWeight: "400" },
        h4: { fontSize: rem(18), lineHeight: rem(24), fontWeight: "300" },
        h5: { fontSize: rem(16), lineHeight: rem(20), fontWeight: "300" },
        h6: { fontSize: rem(14), lineHeight: rem(20), fontWeight: "600" },
    },
};