"use client";

import { type CSSVariablesResolver, MantineProvider } from "@mantine/core";
import { MotionConfig } from "motion/react";

import { darkLightVariables } from "./darkVariants";
import theme from "./index";

/**
 * Overrides on top of Mantine's default variables: placeholder text and
 * input borders one shade darker than the defaults so they stay legible
 * (4.5:1 and 3:1 against white respectively). Dark mode uses Mantine's
 * defaults on the warm `dark` palette (colors.ts), checked in colors.test.ts.
 */
const cssVariablesResolver: CSSVariablesResolver = () => ({
    dark: {
        // Light-variant surfaces that show on the dark page (darkVariants.ts).
        ...darkLightVariables,
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
 * visitor's system setting (`auto`). The CSS variables resolver is a
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
