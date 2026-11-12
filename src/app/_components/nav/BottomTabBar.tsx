"use client";

import { Group, Stack, Text, UnstyledButton } from "@mantine/core";
import {
    IconCalendarEvent,
    IconCalendarStats,
    IconHeartHandshake,
    IconMessageCircle,
    IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
    { href: "/app/events", label: "Events", icon: IconCalendarEvent },
    { href: "/app/discover", label: "Discover", icon: IconHeartHandshake },
    { href: "/app/messages", label: "Messages", icon: IconMessageCircle },
    { href: "/app/bookings", label: "Bookings", icon: IconCalendarStats },
    { href: "/app/profile", label: "Profile", icon: IconUser },
] as const;

export default function BottomTabBar() {
    const pathname = usePathname();

    return (
        <Group
            component="nav"
            aria-label="Main"
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
                    ? "var(--mantine-color-orange-7)"
                    : "var(--mantine-color-gray-7)";
                return (
                    <UnstyledButton
                        key={tab.href}
                        component={Link}
                        href={tab.href}
                        aria-current={isActive ? "page" : undefined}
                        style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            justifyContent: "center",
                        }}
                    >
                        <Stack align="center" gap={2}>
                            <tab.icon size={22} color={color} stroke={isActive ? 2 : 1.5} />
                            <Text
                                fz={11}
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
