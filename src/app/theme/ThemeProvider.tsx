"use client";

import { type CSSVariablesResolver, MantineProvider } from "@mantine/core";
import { MotionConfig } from "motion/react";

import { darkGrayVariables, darkLightVariables } from "./darkVariants";
import theme from "./index";

/**
 * Overrides on top of Mantine's default variables: placeholder text and
 * input borders one shade darker than the defaults so they stay legible
 * (4.5:1 and 3:1 against white respectively). Dark mode uses Mantine's
 * defaults on the neutral `dark` palette (colors.ts), with `gray` moved onto
 * that palette too, checked in colors.test.ts.
 */
const cssVariablesResolver: CSSVariablesResolver = () => ({
    dark: {
        // Light-variant surfaces that show on the dark page (darkVariants.ts).
        ...darkLightVariables,
        // `color="gray"` on the neutral dark scale, not the warm light gray.
        ...darkGrayVariables,
        // Purple's shade 4 is 4.1:1 on the dark page; shade 3 reads.
        "--mantine-color-purple-text": "var(--mantine-color-purple-3)",
    },
    light: {
        "--mantine-color-placeholder": "var(--mantine-color-gray-6)",
    },
    variables: {},
});

/**
 * Client-side wrapper around MantineProvider. The colour scheme follows the
 * visitor's system setting (`auto`) until they choose Light or Dark
 * (ColorSchemeControl). Mantine's default manager keeps the choice in
 * localStorage under `mantine-color-scheme-value`, where the root layout's
 * ColorSchemeScript reads it before the first paint. The CSS variables resolver is a
 * function, so it cannot be passed as a prop from the (server) root layout.
 * `MotionConfig` makes every `motion` animation honour the visitor's
 * reduced-motion preference.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
    return (
        <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
            <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </MantineProvider>
    );
}
