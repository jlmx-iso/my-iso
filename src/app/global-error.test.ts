// global-error.tsx replaces the root layout, so it has no Mantine theme and
// writes its colours as hex. They must be the palette's, not a drifted copy.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import colors, { black } from "./theme/colors";

const source = readFileSync(path.resolve(import.meta.dirname, "global-error.tsx"), "utf8");

describe("global-error colours", () => {
    it("are the theme's: neutral page and text, the coral wordmark and button", () => {
        const used = new Set((source.match(/#[0-9a-f]{6}\b/gi) ?? []).map((hex) => hex.toLowerCase()));
        const roles = new Map<string, string>([
            [colors.gray[0], "page (gray.0)"],
            [black, "text (black)"],
            [colors.orange[8], "wordmark (orange.8)"],
            [colors.gray[6], "secondary text (gray.6)"],
            [colors.orange[3], "button (the brand pastel)"],
            [colors.gray[5], "border (gray.5)"],
        ]);
        expect(used.size).toBeGreaterThan(0);
        for (const hex of used) {
            expect(roles.has(hex), `${hex} is not a palette colour`).toBe(true);
        }
        // The button is the pastel with dark text, like every filled control.
        expect(source).toMatch(new RegExp(`background: "${colors.orange[3]}"[\\s\\S]{0,120}color: "${black}"`));
    });
});
