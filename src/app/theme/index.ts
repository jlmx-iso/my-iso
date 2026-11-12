import { Button, DEFAULT_THEME, Drawer, FileInput, Modal, Rating, createTheme } from "@mantine/core";

import colors, { black } from "./colors";
import { headings } from "./typography";

// The theme follows the Mantine 9 colour model: filled controls use shade 6,
// light variants are solid (shade 9 text on a shade 1 surface) and the default
// radius is `md`. The palette in `colors.ts` is built around that model so
// every variant meets WCAG AA.

// `--font-inter` is the next/font variable set on <html> in the root layout.
const fontFamily = `var(--font-inter), ${DEFAULT_THEME.fontFamily}`;

const theme = createTheme({
    black,
    colors,
    components: {
        Button: Button.extend({ defaultProps: { fw: 600 } }),
        // Icon-only close/clear buttons need an accessible name.
        Drawer: Drawer.extend({ defaultProps: { closeButtonProps: { "aria-label": "Close" } } }),
        FileInput: FileInput.extend({ defaultProps: { clearButtonProps: { "aria-label": "Remove file" } } }),
        Modal: Modal.extend({ defaultProps: { closeButtonProps: { "aria-label": "Close" } } }),
        // Mantine's yellow stars are 1.6:1 against white.
        Rating: Rating.extend({ defaultProps: { color: "tan" } }),
    },
    fontFamily,
    // Labels and other "medium" text stay at 500; buttons are semi-bold.
    fontWeights: { medium: "500" },
    headings: { ...headings, fontFamily },
    primaryColor: "orange",
    primaryShade: 6,
    respectReducedMotion: true,
});

export default theme;
