"use client";

import { Group, Stack, Text, UnstyledButton } from "@mantine/core";
import {
    IconCalendarEvent,
    IconMessageCircle,
    IconSearch,
    IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
    { href: "/app/events", label: "Events", icon: IconCalendarEvent },
    { href: "/app/search", label: "Search", icon: IconSearch },
    { href: "/app/messages", label: "Messages", icon: IconMessageCircle },
    { href: "/app/profile", label: "Profile", icon: IconUser },
] as const;

export default function BottomTabBar() {
    const pathname = usePathname();

    return (
        <Group
            h="100%"
            justify="space-around"
            align="center"
            wrap="nowrap"
            px="xs"
            style={{
                borderTop: "1px solid var(--mantine-color-gray-2)",
            }}
        >
            {tabs.map((tab) => {
                const isActive = pathname.startsWith(tab.href);
                const color = isActive
                    ? "var(--mantine-color-orange-5)"
                    : "var(--mantine-color-gray-5)";
                return (
                    <UnstyledButton
                        key={tab.href}
                        component={Link}
                        href={tab.href}
                        style={{
                            flex: 1,
                            display: "flex",
                            justifyContent: "center",
                        }}
                    >
                        <Stack align="center" gap={2}>
                            <tab.icon size={22} color={color} stroke={isActive ? 2 : 1.5} />
                            <Text
                                fz={10}
                                fw={isActive ? 600 : 400}
                                c={color}
                                lh={1}
                            >
                                {tab.label}
                            </Text>
                        </Stack>
                    </UnstyledButton>
                );
            })}
        </Group>
    );
}
