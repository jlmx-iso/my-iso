"use client";

import { type CSSVariablesResolver, MantineProvider } from "@mantine/core";
import { MotionConfig } from "motion/react";

import theme from "./index";

/**
 * Overrides on top of Mantine's default variables: placeholder text and
 * input borders one shade darker than the defaults so they stay legible
 * (4.5:1 and 3:1 against white respectively).
 */
const cssVariablesResolver: CSSVariablesResolver = () => ({
    dark: {},
    light: {
        "--mantine-color-placeholder": "var(--mantine-color-gray-6)",
    },
    variables: {},
});

/**
 * Client-side wrapper around MantineProvider: the CSS variables resolver is a
 * function, so it cannot be passed as a prop from the (server) root layout.
 * `MotionConfig` makes every `motion` animation honour the visitor's
 * reduced-motion preference.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
    return (
        <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="light">
            <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </MantineProvider>
    );
}
