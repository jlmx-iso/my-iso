"use client";

import { type CSSVariablesResolver, MantineProvider } from "@mantine/core";
import { MotionConfig } from "motion/react";

import theme from "./index";
import { ThemeColorSync } from "./ThemeColorSync";
import { schemeVariables } from "./variants";

/**
 * The palette's variant variables for each scheme (variants.ts): pastel
 * fills with dark text, coloured text at shades that reach 4.5:1, notices,
 * and the anchor, error and success colours. Checked in colors.test.ts.
 */
const cssVariablesResolver: CSSVariablesResolver = () => ({
    dark: schemeVariables("dark"),
    light: schemeVariables("light"),
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
            <ThemeColorSync />
            <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </MantineProvider>
    );
}
