import { createTheme } from "@mantine/core";

import colors from "./colors";
import { headings } from "./typography";

const theme = createTheme({
    colors,
    headings,
    primaryColor: "orange",
    primaryShade: 3,
});

export default theme;