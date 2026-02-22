"use client";

import {
    Badge,
    Button,
    Container,
    Group,
    Paper,
    Stack,
    Tabs,
    Text,
    ThemeIcon,
} from "@mantine/core";
import {
    IconBell,
    IconCalendarEvent,
    IconCamera,
    IconCheck,
    IconEye,
    IconMessageCircle,
    IconStar,
    IconX,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import EmptyState from "~/app/_components/EmptyState";
import PageHeader from "~/app/_components/PageHeader";
import { api } from "~/trpc/react";

const NOTIFICATION_TYPE_ICONS: Record<string, typeof IconBell> = {
    booking_applied: IconCalendarEvent,
    booking_accepted: IconCheck,
    booking_declined: IconX,
    booking_completed: IconCamera,
    new_message: IconMessageCircle,
    review_received: IconStar,
    profile_view: IconEye,
};

const NOTIFICATION_TYPE_COLORS: Record<string, string> = {
    booking_applied: "orange",
    booking_accepted: "green",
    booking_declined: "red",
    booking_completed: "teal",
    new_message: "blue",
    review_received: "yellow",
    profile_view: "grape",
};

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

const PAGE_SIZE = 20;

export default function NotificationsPage() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<string | null>("all");
    const [offset, setOffset] = useState(0);

    const unreadOnly = activeTab === "unread";

    const utils = api.useUtils();

    const { data, isLoading } = api.notification.getAll.useQuery({
        limit: PAGE_SIZE,
        offset,
        unreadOnly,
    });

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

    const handleNotificationClick = (
        notificationId: string,
        linkUrl: string | null,
        isRead: boolean,
    ) => {
        if (!isRead) {
            markAsRead.mutate({ notificationId });
        }
        if (linkUrl) {
            router.push(linkUrl);
        }
    };

    const handleTabChange = (value: string | null) => {
        setActiveTab(value);
        setOffset(0);
    };

    const notifications = data?.notifications ?? [];
    const totalCount = data?.totalCount ?? 0;
    const unreadCount = data?.unreadCount ?? 0;
    const hasMore = offset + PAGE_SIZE < totalCount;

    return (
        <Container size="md" py="xl">
            <Stack gap="lg">
                <PageHeader
                    title="Notifications"
                    description={
                        unreadCount > 0
                            ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
                            : "You're all caught up"
                    }
                    action={
                        unreadCount > 0 ? (
                            <Button
                                variant="light"
                                color="orange"
                                size="sm"
                                leftSection={<IconCheck size={16} />}
                                onClick={() => markAllAsRead.mutate()}
                                loading={markAllAsRead.isPending}
                            >
                                Mark all as read
                            </Button>
                        ) : undefined
                    }
                />

                <Tabs value={activeTab} onChange={handleTabChange}>
                    <Tabs.List>
                        <Tabs.Tab value="all">
                            All
                            {totalCount > 0 && (
                                <Badge
                                    size="xs"
                                    variant="filled"
                                    color="gray"
                                    ml={6}
                                >
                                    {totalCount}
                                </Badge>
                            )}
                        </Tabs.Tab>
                        <Tabs.Tab value="unread">
                            Unread
                            {unreadCount > 0 && (
                                <Badge
                                    size="xs"
                                    variant="filled"
                                    color="orange"
                                    ml={6}
                                >
                                    {unreadCount}
                                </Badge>
                            )}
                        </Tabs.Tab>
                    </Tabs.List>
                </Tabs>

                {isLoading ? (
                    <Text c="dimmed" ta="center" py="xl">
                        Loading notifications...
                    </Text>
                ) : notifications.length === 0 ? (
                    <EmptyState
                        icon={IconBell}
                        title={
                            unreadOnly
                                ? "No unread notifications"
                                : "No notifications yet"
                        }
                        description={
                            unreadOnly
                                ? "You've read all your notifications."
                                : "When you receive bookings, messages, or reviews, they'll show up here."
                        }
                    />
                ) : (
                    <Stack gap="xs">
                        {notifications.map((notification) => {
                            const TypeIcon =
                                NOTIFICATION_TYPE_ICONS[notification.type] ??
                                IconBell;
                            const iconColor =
                                NOTIFICATION_TYPE_COLORS[notification.type] ??
                                "gray";

                            return (
                                <Paper
                                    key={notification.id}
                                    p="md"
                                    radius="md"
                                    withBorder
                                    style={{
                                        cursor: notification.linkUrl
                                            ? "pointer"
                                            : "default",
                                        backgroundColor: notification.isRead
                                            ? "transparent"
                                            : "var(--mantine-color-orange-0)",
                                        transition:
                                            "background-color 150ms ease",
                                    }}
                                    onClick={() =>
                                        handleNotificationClick(
                                            notification.id,
                                            notification.linkUrl,
                                            notification.isRead,
                                        )
                                    }
                                >
                                    <Group
                                        wrap="nowrap"
                                        align="flex-start"
                                        gap="md"
                                    >
                                        <ThemeIcon
                                            size="lg"
                                            radius="xl"
                                            variant="light"
                                            color={iconColor}
                                            mt={2}
                                        >
                                            <TypeIcon size={18} />
                                        </ThemeIcon>
                                        <Stack
                                            gap={4}
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                            }}
                                        >
                                            <Group
                                                justify="space-between"
                                                wrap="nowrap"
                                            >
                                                <Text
                                                    size="sm"
                                                    fw={
                                                        notification.isRead
                                                            ? 400
                                                            : 600
                                                    }
                                                    lineClamp={1}
                                                >
                                                    {notification.title}
                                                </Text>
                                                <Group
                                                    gap={6}
                                                    wrap="nowrap"
                                                    style={{
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    {!notification.isRead && (
                                                        <Badge
                                                            size="xs"
                                                            variant="filled"
                                                            color="orange"
                                                        >
                                                            New
                                                        </Badge>
                                                    )}
                                                    <Text
                                                        size="xs"
                                                        c="dimmed"
                                                        style={{
                                                            whiteSpace:
                                                                "nowrap",
                                                        }}
                                                    >
                                                        {timeAgo(
                                                            new Date(
                                                                notification.createdAt,
                                                            ),
                                                        )}
                                                    </Text>
                                                </Group>
                                            </Group>
                                            <Text
                                                size="sm"
                                                c="dimmed"
                                                lineClamp={2}
                                            >
                                                {notification.body}
                                            </Text>
                                        </Stack>
                                    </Group>
                                </Paper>
                            );
                        })}

                        {hasMore && (
                            <Group justify="center" pt="md">
                                <Button
                                    variant="light"
                                    color="orange"
                                    onClick={() =>
                                        setOffset((prev) => prev + PAGE_SIZE)
                                    }
                                >
                                    Load more
                                </Button>
                            </Group>
                        )}
                    </Stack>
                )}
            </Stack>
        </Container>
    );
}
