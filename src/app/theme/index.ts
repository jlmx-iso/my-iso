import { Alert, Button, DEFAULT_THEME, Drawer, FileInput, Indicator, Modal, Notification, Rating, Tabs, createTheme } from "@mantine/core";

import colors, { black } from "./colors";
import notificationClasses from "./Notification.module.css";
import { headings } from "./typography";
import { BRAND_SHADE, noticeVars, notificationColor, outlineButtonVars, variantColorResolver } from "./variants";

// The original ISO pastels are the brand colours in both schemes: filled
// controls use shade 3 with dark text (autoContrast), and coloured text uses
// a darker shade of the same scale. The variant rules are in variants.ts,
// the palette in colors.ts, and every pairing is asserted in colors.test.ts.

// `--font-inter` is the next/font variable set on <html> in the root layout.
const fontFamily = `var(--font-inter), ${DEFAULT_THEME.fontFamily}`;

const theme = createTheme({
    // Dark text on every fill light enough to need it: all the pastels.
    autoContrast: true,
    black,
    colors,
    components: {
        // Notices: a tinted panel on white, a raised navy panel with a coloured edge in dark mode.
        Alert: Alert.extend({ vars: (theme, props) => noticeVars(props.color, props.variant, theme.primaryColor) }),
        // Secondary (outline) buttons: the colour's text with a softer pastel edge.
        Button: Button.extend({
            defaultProps: { fw: 600 },
            vars: (theme, props) => outlineButtonVars(props.color, props.variant, theme.primaryColor),
        }),
        // Icon-only close/clear buttons need an accessible name.
        Drawer: Drawer.extend({ defaultProps: { closeButtonProps: { "aria-label": "Close" } } }),
        FileInput: FileInput.extend({ defaultProps: { clearButtonProps: { "aria-label": "Remove file" } } }),
        // Unread counts: teal (information), not the brand salmon.
        Indicator: Indicator.extend({ defaultProps: { color: "teal" } }),
        Modal: Modal.extend({ defaultProps: { closeButtonProps: { "aria-label": "Close" } } }),
        // Toasts: one look for every kind, see Notification.module.css.
        Notification: Notification.extend({
            classNames: notificationClasses,
            defaultProps: { closeButtonProps: { "aria-label": "Dismiss notification" } },
            // The colour's text shade: white icons on it are at least 4.5:1.
            vars: (_theme, props) => ({ root: { "--notification-color": notificationColor(props.color) } }),
        }),
        // Stars at 3:1 on white and on the dark page (--iso-rating, globals.css).
        Rating: Rating.extend({ defaultProps: { color: "var(--iso-rating)" } }),
        // The active tab's line in the accent text colour (the pastel is 2.4:1 on white).
        Tabs: Tabs.extend({ defaultProps: { color: "var(--iso-accent-text)" } }),
    },
    fontFamily,
    // Labels and other "medium" text stay at 500; buttons are semi-bold.
    fontWeights: { medium: "500" },
    // Every brand pastel is above it, so it carries dark text.
    luminanceThreshold: 0.3,
    headings: { ...headings, fontFamily },
    primaryColor: "orange",
    primaryShade: { dark: BRAND_SHADE, light: BRAND_SHADE },
    respectReducedMotion: true,
    variantColorResolver,
});

export default theme;
