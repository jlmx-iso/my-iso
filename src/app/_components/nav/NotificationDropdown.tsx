"use client";

import {
    Box,
    Button,
    Divider,
    Group,
    Popover,
    ScrollArea,
    Stack,
    Text,
    UnstyledButton,
} from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import dayjs from "~/_lib/dayjs";
import { api } from "~/trpc/react";

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

    const { data, isPending, isError } = api.notification.getAll.useQuery(
        { limit: 5, offset: 0, unreadOnly: false },
        { enabled: opened },
    );

    const invalidate = () => {
        void utils.notification.getAll.invalidate();
        void utils.notification.getUnreadCount.invalidate();
    };
    const markAsRead = api.notification.markAsRead.useMutation({ onSuccess: invalidate });
    const markAllAsRead = api.notification.markAllAsRead.useMutation({ onSuccess: invalidate });

    const handleNotificationClick = (notificationId: string, linkUrl: string | null, isRead: boolean) => {
        if (!isRead) {
            markAsRead.mutate({ notificationId });
        }
        if (linkUrl) {
            router.push(linkUrl);
        }
        onClose();
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
            trapFocus
            returnFocus
        >
            <Popover.Target>{target}</Popover.Target>
            <Popover.Dropdown p={0} aria-label="Notifications">
                <Group justify="space-between" px="md" py="sm">
                    <Text fw={600} size="sm">
                        Notifications
                    </Text>
                    {unreadCount > 0 && (
                        <Button
                            variant="subtle"
                            size="compact-xs"
                            leftSection={<IconCheck size={14} />}
                            onClick={() => markAllAsRead.mutate()}
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
                            {isError
                                ? "Couldn't load notifications."
                                : isPending
                                    ? "Loading…"
                                    : "No notifications yet"}
                        </Text>
                    ) : (
                        <Stack gap={0}>
                            {notifications.map((notification) => (
                                <UnstyledButton
                                    key={notification.id}
                                    className="row-interactive"
                                    onClick={() =>
                                        handleNotificationClick(
                                            notification.id,
                                            notification.linkUrl,
                                            notification.isRead,
                                        )
                                    }
                                    px="md"
                                    py="sm"
                                    w="100%"
                                    display="block"
                                    bg={notification.isRead ? undefined : "orange.0"}
                                    style={{ outlineOffset: -2 }}
                                >
                                    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                                        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                                            <Text
                                                size="sm"
                                                fw={notification.isRead ? 400 : 600}
                                                lineClamp={1}
                                            >
                                                {!notification.isRead && (
                                                    <span className="sr-only">Unread: </span>
                                                )}
                                                {notification.title}
                                            </Text>
                                            <Text size="xs" c="dimmed" lineClamp={2}>
                                                {notification.body}
                                            </Text>
                                        </Stack>
                                        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                                            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                                                {dayjs(notification.createdAt).fromNow()}
                                            </Text>
                                            {!notification.isRead && (
                                                <Box
                                                    aria-hidden
                                                    w={8}
                                                    h={8}
                                                    bg="orange.6"
                                                    style={{ borderRadius: "50%" }}
                                                />
                                            )}
                                        </Group>
                                    </Group>
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
