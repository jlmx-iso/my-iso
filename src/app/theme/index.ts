import { Button, createTheme } from "@mantine/core";

import colors from "./colors";
import { headings } from "./typography";

// Mantine 9 changed defaults that alter the look of every component: the
// default radius (sm -> md), a themeable "medium" font weight of 600 where
// 8.x used 500 for labels and 600 for buttons, and solid light-variant colours
// (see ThemeProvider). The overrides below pin the 8.x design so the upgrade
// is visually neutral; adopting the 9.x look is a separate design decision.
const theme = createTheme({
    colors,
    components: {
        // 8.x buttons were semi-bold; 9.x ties them to the "medium" weight.
        Button: Button.extend({ defaultProps: { fw: 600 } }),
    },
    defaultRadius: "sm",
    fontWeights: { medium: "500" },
    headings,
    primaryColor: "orange",
    primaryShade: 3,
});

export default theme;
