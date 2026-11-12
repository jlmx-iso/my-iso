"use client";

import { ActionIcon, Indicator } from "@mantine/core";
import { IconBell } from "@tabler/icons-react";
import { useState } from "react";

import { NotificationDropdown } from "./NotificationDropdown";

export function NotificationBell({ unreadCount }: { unreadCount: number }) {
    const [opened, setOpened] = useState(false);

    return (
        // The indicator wraps the popover (not the other way round) so the
        // popover's ARIA attributes land on the button.
        <Indicator
            label={unreadCount > 99 ? "99+" : unreadCount}
            size={16}
            disabled={unreadCount === 0}
            offset={4}
        >
            <NotificationDropdown
                opened={opened}
                onClose={() => setOpened(false)}
                target={
                    <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="lg"
                        radius="xl"
                        onClick={() => setOpened((prev) => !prev)}
                        aria-label={
                            unreadCount > 0
                                ? `Notifications, ${unreadCount} unread`
                                : "Notifications"
                        }
                        aria-expanded={opened}
                        aria-haspopup="dialog"
                    >
                        <IconBell size={22} />
                    </ActionIcon>
                }
            />
        </Indicator>
    );
}
