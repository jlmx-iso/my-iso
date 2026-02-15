"use client";

import { type LoaderProps, Loader as MantineLoader } from "@mantine/core";

export const Loader = (props: LoaderProps) => {
    return <MantineLoader {...props} />
};
