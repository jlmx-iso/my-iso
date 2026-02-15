"use client";

import { ActionIcon, Indicator } from "@mantine/core";
import { IconBell } from "@tabler/icons-react";
import { useState } from "react";

import { api } from "~/trpc/react";
import { NotificationDropdown } from "./NotificationDropdown";

export function NotificationBell() {
    const [opened, setOpened] = useState(false);

    const { data } = api.notification.getUnreadCount.useQuery(undefined, {
        refetchInterval: 30000,
    });

    const unreadCount = data?.count ?? 0;

    return (
        <NotificationDropdown
            opened={opened}
            onClose={() => setOpened(false)}
            target={
                <Indicator
                    label={unreadCount > 99 ? "99+" : unreadCount}
                    size={16}
                    color="orange"
                    disabled={unreadCount === 0}
                    offset={4}
                >
                    <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="lg"
                        radius="xl"
                        onClick={() => setOpened((prev) => !prev)}
                        aria-label="Notifications"
                        aria-expanded={opened}
                        aria-haspopup="true"
                    >
                        <IconBell size={22} />
                    </ActionIcon>
                </Indicator>
            }
        />
    );
}
