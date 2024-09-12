import { type MantineTheme, rem } from "@mantine/core";

export const headings: Partial<MantineTheme["headings"]> = {
    sizes: {
        h1: { fontSize: rem(36), fontWeight: "700", lineHeight: rem(48) },
        h2: { fontSize: rem(32), fontWeight: "500", lineHeight: rem(36) },
        h3: { fontSize: rem(20), fontWeight: "400", lineHeight: rem(24) },
        h4: { fontSize: rem(18), fontWeight: "300", lineHeight: rem(24) },
        h5: { fontSize: rem(16), fontWeight: "300", lineHeight: rem(20) },
        h6: { fontSize: rem(14), fontWeight: "600", lineHeight: rem(20) },
    },
};