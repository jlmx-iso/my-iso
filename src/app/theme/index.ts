import { Button, DEFAULT_THEME, Drawer, FileInput, Modal, Notification, Rating, createTheme } from "@mantine/core";

import colors, { black } from "./colors";
import notificationClasses from "./Notification.module.css";
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
        // Toasts: one look for every kind, see Notification.module.css.
        Notification: Notification.extend({
            classNames: notificationClasses,
            defaultProps: { closeButtonProps: { "aria-label": "Dismiss notification" } },
            // Shade 7: white icons on it are at least 4.5:1 for every colour.
            vars: (theme, props) => ({
                root: { "--notification-color": theme.colors[props.color ?? "orange"]?.[7] ?? theme.colors.orange[7] },
            }),
        }),
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
