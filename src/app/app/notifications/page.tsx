"use client";

import {
    Alert,
    Badge,
    Button,
    Group,
    Paper,
    SegmentedControl,
    Skeleton,
    Stack,
    Text,
    ThemeIcon,
} from "@mantine/core";
import {
    IconAlertCircle,
    IconBell,
    IconCalendarEvent,
    IconCamera,
    IconCheck,
    IconEye,
    IconMessageCircle,
    IconStar,
    IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";

import { formatRelative } from "~/_lib/dayjs";
import EmptyState from "~/app/_components/EmptyState";
import PageHeader from "~/app/_components/PageHeader";
import { type RouterOutputs, api } from "~/trpc/react";

type Notification = RouterOutputs["notification"]["getAll"]["notifications"][number];
type Filter = "all" | "unread";

const NOTIFICATION_TYPE_ICONS: Record<string, typeof IconBell> = {
    booking_accepted: IconCheck,
    booking_applied: IconCalendarEvent,
    booking_completed: IconCamera,
    booking_declined: IconX,
    new_message: IconMessageCircle,
    profile_view: IconEye,
    review_received: IconStar,
};

const NOTIFICATION_TYPE_COLORS: Record<string, string> = {
    booking_accepted: "green",
    booking_applied: "orange",
    booking_completed: "teal",
    booking_declined: "red",
    new_message: "blue",
    profile_view: "purple",
    review_received: "tan",
};

const PAGE_SIZE = 20;

function NotificationRow({
    notification,
    onRead,
}: {
    notification: Notification;
    onRead: (id: string) => void;
}) {
    const TypeIcon = NOTIFICATION_TYPE_ICONS[notification.type] ?? IconBell;
    const markRead = () => {
        if (!notification.isRead) onRead(notification.id);
    };

    const content = (
        <Group wrap="nowrap" align="flex-start" gap="md">
            <ThemeIcon
                size="lg"
                radius="xl"
                variant="light"
                color={NOTIFICATION_TYPE_COLORS[notification.type] ?? "gray"}
                mt={2}
            >
                <TypeIcon size={18} aria-hidden />
            </ThemeIcon>
            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Text size="sm" fw={notification.isRead ? 400 : 600} lineClamp={2}>
                        {notification.title}
                    </Text>
                    <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                        {!notification.isRead && (
                            <Badge size="sm" variant="filled">
                                New
                            </Badge>
                        )}
                        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                            {formatRelative(notification.createdAt)}
                        </Text>
                    </Group>
                </Group>
                <Text size="sm" c="dimmed" lineClamp={3}>
                    {notification.body}
                </Text>
            </Stack>
        </Group>
    );

    const paperProps = {
        bg: notification.isRead ? undefined : "orange.0",
        p: "md",
        radius: "md",
        w: "100%",
        withBorder: true,
    } as const;

    return (
        <li style={{ listStyle: "none" }} data-testid="notification-row">
            {notification.linkUrl ? (
                // Navigates; marked read on the way.
                <Paper
                    component={Link}
                    href={notification.linkUrl}
                    onClick={markRead}
                    className="card-interactive"
                    display="block"
                    {...paperProps}
                >
                    {content}
                </Paper>
            ) : notification.isRead ? (
                <Paper {...paperProps}>{content}</Paper>
            ) : (
                // Nowhere to go: activating it marks it read.
                <Paper
                    component="button"
                    type="button"
                    onClick={markRead}
                    className="card-interactive"
                    display="block"
                    ta="left"
                    style={{ cursor: "pointer", font: "inherit" }}
                    {...paperProps}
                >
                    <span className="sr-only">Mark as read: </span>
                    {content}
                </Paper>
            )}
        </li>
    );
}

export default function NotificationsPage() {
    const [filter, setFilter] = useState<Filter>("all");
    const [pageCount, setPageCount] = useState(1);
    const unreadOnly = filter === "unread";
    const utils = api.useUtils();

    // One query per loaded page, so "Load more" appends instead of replacing.
    const pages = api.useQueries((t) =>
        Array.from({ length: pageCount }, (_, index) =>
            t.notification.getAll({ limit: PAGE_SIZE, offset: index * PAGE_SIZE, unreadOnly }),
        ),
    );

    const invalidate = () => {
        void utils.notification.getAll.invalidate();
        void utils.notification.getUnreadCount.invalidate();
    };
    const markAsRead = api.notification.markAsRead.useMutation({ onSuccess: invalidate });
    const markAllAsRead = api.notification.markAllAsRead.useMutation({ onSuccess: invalidate });

    const firstPage = pages[0];
    const lastPage = pages[pages.length - 1];
    // A notification can shift between pages when new ones arrive: keep one copy.
    const notifications = [
        ...new Map(
            pages.flatMap((page) => page.data?.notifications ?? []).map((item) => [item.id, item]),
        ).values(),
    ];
    const totalCount = firstPage?.data?.totalCount ?? 0;
    const unreadCount = firstPage?.data?.unreadCount ?? 0;
    const hasMore = pageCount * PAGE_SIZE < totalCount;
    const isLoadingFirst = !!firstPage?.isPending;
    const isLoadingMore = pageCount > 1 && !!lastPage?.isPending;

    return (
        <Stack gap="lg" maw={760} mx="auto">
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

            <SegmentedControl
                aria-label="Show"
                value={filter}
                onChange={(value) => {
                    setFilter(value);
                    setPageCount(1);
                }}
                data={[
                    { label: "All", value: "all" },
                    { label: unreadCount > 0 ? `Unread (${unreadCount})` : "Unread", value: "unread" },
                ]}
                w="fit-content"
            />

            {isLoadingFirst ? (
                <Stack gap="xs" aria-busy="true" aria-label="Loading notifications">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} height={84} radius="md" />
                    ))}
                </Stack>
            ) : firstPage?.isError ? (
                <Alert color="red" icon={<IconAlertCircle size={16} />} title="We couldn't load your notifications">
                    <Button variant="default" size="xs" mt="xs" onClick={() => void firstPage.refetch()}>
                        Try again
                    </Button>
                </Alert>
            ) : notifications.length === 0 ? (
                <EmptyState
                    icon={IconBell}
                    title={unreadOnly ? "No unread notifications" : "No notifications yet"}
                    description={
                        unreadOnly
                            ? "You've read all your notifications."
                            : "When you receive bookings, messages, or reviews, they'll show up here."
                    }
                />
            ) : (
                <Stack gap="xs">
                    <Stack gap="xs" component="ul" m={0} p={0} aria-label="Notifications">
                        {notifications.map((notification) => (
                            <NotificationRow
                                key={notification.id}
                                notification={notification}
                                onRead={(notificationId) => markAsRead.mutate({ notificationId })}
                            />
                        ))}
                    </Stack>

                    {hasMore && (
                        <Group justify="center" pt="md">
                            <Button
                                variant="default"
                                onClick={() => setPageCount((current) => current + 1)}
                                loading={isLoadingMore}
                            >
                                Load more
                            </Button>
                        </Group>
                    )}
                </Stack>
            )}
        </Stack>
    );
}
