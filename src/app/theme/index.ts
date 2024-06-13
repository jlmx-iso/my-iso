import { createTheme } from "@mantine/core";
import colors from "./colors";
import { headings } from "./typography";

const theme = createTheme({
    primaryColor: "orange",
    primaryShade: 3,
    colors,
    headings,
});

export default theme;