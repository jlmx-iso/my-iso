import { createTheme } from "@mantine/core";

import colors from "./colors";
import { headings } from "./typography";

// Mantine 9 changed three defaults that alter the look of every component:
// the default radius (sm -> md), the "medium" font weight (500 -> 600) and
// the light variant colours (see ThemeProvider). `defaultRadius` and
// `fontWeights` below pin the 8.x values so the upgrade is visually neutral;
// adopting the 9.x defaults is a design decision to take separately.
const theme = createTheme({
    colors,
    defaultRadius: "sm",
    fontWeights: { medium: "500" },
    headings,
    primaryColor: "orange",
    primaryShade: 3,
});

export default theme;
