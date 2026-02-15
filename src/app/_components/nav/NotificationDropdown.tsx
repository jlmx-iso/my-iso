"use client";

import {
    Button,
    Divider,
    Group,
    Paper,
    Popover,
    ScrollArea,
    Stack,
    Text,
    UnstyledButton,
} from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

function timeAgo(date: Date): string {
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(months / 12);
    return `${years}y ago`;
}

type NotificationDropdownProps = {
    opened: boolean;
    onClose: () => void;
    target: React.ReactNode;
};

export function NotificationDropdown({
    opened,
    onClose,
    target,
}: NotificationDropdownProps) {
    const router = useRouter();
    const utils = api.useUtils();

    const { data } = api.notification.getAll.useQuery(
        { limit: 5, offset: 0, unreadOnly: false },
        { enabled: opened },
    );

    const markAsRead = api.notification.markAsRead.useMutation({
        onSuccess: () => {
            void utils.notification.getAll.invalidate();
            void utils.notification.getUnreadCount.invalidate();
        },
    });

    const markAllAsRead = api.notification.markAllAsRead.useMutation({
        onSuccess: () => {
            void utils.notification.getAll.invalidate();
            void utils.notification.getUnreadCount.invalidate();
        },
    });

    const handleNotificationClick = (notificationId: string, linkUrl: string | null, isRead: boolean) => {
        if (!isRead) {
            markAsRead.mutate({ notificationId });
        }
        if (linkUrl) {
            router.push(linkUrl);
        }
        onClose();
    };

    const handleMarkAllAsRead = () => {
        markAllAsRead.mutate();
    };

    const notifications = data?.notifications ?? [];
    const unreadCount = data?.unreadCount ?? 0;

    return (
        <Popover
            opened={opened}
            onClose={onClose}
            position="bottom-end"
            width={360}
            shadow="lg"
            radius="md"
        >
            <Popover.Target>{target}</Popover.Target>
            <Popover.Dropdown p={0}>
                <Group justify="space-between" px="md" py="sm">
                    <Text fw={600} size="sm">
                        Notifications
                    </Text>
                    {unreadCount > 0 && (
                        <Button
                            variant="subtle"
                            size="compact-xs"
                            color="orange"
                            leftSection={<IconCheck size={14} />}
                            onClick={handleMarkAllAsRead}
                            loading={markAllAsRead.isPending}
                        >
                            Mark all read
                        </Button>
                    )}
                </Group>
                <Divider />
                <ScrollArea.Autosize mah={320}>
                    {notifications.length === 0 ? (
                        <Text c="dimmed" size="sm" ta="center" py="xl" px="md">
                            No notifications yet
                        </Text>
                    ) : (
                        <Stack gap={0}>
                            {notifications.map((notification) => (
                                <UnstyledButton
                                    key={notification.id}
                                    onClick={() =>
                                        handleNotificationClick(
                                            notification.id,
                                            notification.linkUrl,
                                            notification.isRead,
                                        )
                                    }
                                    style={{
                                        display: "block",
                                        width: "100%",
                                    }}
                                >
                                    <Paper
                                        px="md"
                                        py="sm"
                                        radius={0}
                                        pos="relative"
                                        style={{
                                            backgroundColor: notification.isRead
                                                ? "transparent"
                                                : "var(--mantine-color-orange-0)",
                                            cursor: "pointer",
                                            transition: "background-color 150ms ease",
                                        }}
                                        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                                            if (notification.isRead) {
                                                e.currentTarget.style.backgroundColor =
                                                    "var(--mantine-color-gray-0)";
                                            }
                                        }}
                                        onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                                            if (notification.isRead) {
                                                e.currentTarget.style.backgroundColor =
                                                    "transparent";
                                            }
                                        }}
                                    >
                                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                                            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                                                <Text
                                                    size="sm"
                                                    fw={notification.isRead ? 400 : 600}
                                                    lineClamp={1}
                                                >
                                                    {notification.title}
                                                </Text>
                                                <Text
                                                    size="xs"
                                                    c="dimmed"
                                                    lineClamp={2}
                                                >
                                                    {notification.body}
                                                </Text>
                                            </Stack>
                                            <Text
                                                size="xs"
                                                c="dimmed"
                                                style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                                            >
                                                {timeAgo(new Date(notification.createdAt))}
                                            </Text>
                                        </Group>
                                        {!notification.isRead && (
                                            <div
                                                style={{
                                                    width: 6,
                                                    height: 6,
                                                    borderRadius: "50%",
                                                    backgroundColor: "var(--mantine-color-orange-5)",
                                                    position: "absolute",
                                                    top: 12,
                                                    right: 12,
                                                }}
                                            />
                                        )}
                                    </Paper>
                                </UnstyledButton>
                            ))}
                        </Stack>
                    )}
                </ScrollArea.Autosize>
                <Divider />
                <Group justify="center" py="xs">
                    <Button
                        variant="subtle"
                        size="compact-sm"
                        color="orange"
                        component={Link}
                        href="/app/notifications"
                        onClick={onClose}
                    >
                        View all notifications
                    </Button>
                </Group>
            </Popover.Dropdown>
        </Popover>
    );
}
