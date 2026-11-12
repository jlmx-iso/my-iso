"use client";

import { MantineProvider, v8CssVariablesResolver } from "@mantine/core";

import theme from "./index";

/**
 * Client-side wrapper around MantineProvider: the CSS variables resolver is a
 * function, so it cannot be passed as a prop from the (server) root layout.
 *
 * `v8CssVariablesResolver` keeps the translucent light-variant colours of
 * Mantine 8; Mantine 9 switched them to solid colours.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
    return (
        <MantineProvider theme={theme} cssVariablesResolver={v8CssVariablesResolver}>
            {children}
        </MantineProvider>
    );
}
