"use client";

import { useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { useEffect } from "react";

import { THEME_COLOR } from "./themeColor";

/**
 * Keeps the browser bar (`<meta name="theme-color">`) in step with the
 * chosen scheme. The root layout renders one tag per system scheme, chosen
 * by `media`; when the member picks Light or Dark, both carry that scheme's
 * colour, and on System each goes back to its own. Renders nothing.
 */
export function ThemeColorSync() {
    const { colorScheme } = useMantineColorScheme();
    const computed = useComputedColorScheme("light");

    useEffect(() => {
        for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
            const own = meta.media.includes("dark") ? THEME_COLOR.dark : THEME_COLOR.light;
            meta.content = colorScheme === "auto" ? own : THEME_COLOR[computed];
        }
    }, [colorScheme, computed]);

    return null;
}
