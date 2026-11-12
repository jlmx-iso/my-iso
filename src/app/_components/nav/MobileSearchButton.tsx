"use client";

import { ActionIcon } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import Link from "next/link";

/** Search entry point in the mobile header; the tab bar holds the other sections. */
export default function MobileSearchButton() {
    return (
        <ActionIcon
            component={Link}
            href="/app/search"
            variant="subtle"
            color="gray"
            size="xl"
            aria-label="Search"
            title="Search"
        >
            <IconSearch size={24} stroke={1.5} />
        </ActionIcon>
    );
}
