"use client";

import { Badge, Box, Button, Group, Stack, Text } from "@mantine/core";
import { IconMessageCircle } from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import { sortThreadsByRecency } from "~/_utils/messagePanes";
import { fullName } from "~/_utils/names";
import { THREADS_PAGE_SIZE } from "~/_utils/pageSizes";
import { mergePages } from "~/_utils/pagination";
import { threadsWithNewActivity, unreadBadgeLabel, unreadMessagesLabel } from "~/_utils/unread";
import { Avatar } from "~/app/_components/Avatar";
import EmptyState from "~/app/_components/EmptyState";
import Timemarker from "~/app/_components/Timemarker";
import { useFocusNewItems } from "~/app/_hooks/useFocusNewItems";
import { type RouterOutputs, api } from "~/trpc/react";

import classes from "./MessagesShell.module.css";

type Thread = RouterOutputs["message"]["getThreadsPage"]["items"][number];
type LatestMessage = RouterOutputs["message"]["getLatestThreadMessage"];

export type ConversationSummary = Thread & { lastMessage: LatestMessage };

type ConversationListProps = {
    initialThreads: ConversationSummary[];
    initialNextCursor: string | null;
    currentUserId: string;
    selectedThreadId: string | null;
};

/** How often to look for new conversations and new messages. */
const THREADS_POLL_MS = 15_000;

/**
 * Conversation list, most recent first, a page at a time ("Load older
 * conversations"). The list itself is polled and says, per conversation, how
 * much is unread. Previews follow the `getLatestThreadMessage` cache, which
 * the open thread updates as messages are sent or arrive; for the other
 * conversations a preview is only refetched when the list shows something
 * happened there.
 */
export default function ConversationList({ initialThreads, initialNextCursor, currentUserId, selectedThreadId }: ConversationListProps) {
    const threadPages = api.message.getThreadsPage.useInfiniteQuery(
        { limit: THREADS_PAGE_SIZE },
        {
            getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
            initialData: {
                pageParams: [undefined],
                pages: [{
                    items: initialThreads.map(({ lastMessage: _lastMessage, ...thread }) => thread),
                    nextCursor: initialNextCursor,
                }],
            },
            refetchInterval: THREADS_POLL_MS,
            refetchIntervalInBackground: false,
        },
    );
    const utils = api.useUtils();
    // A conversation can move between pages while they are refetched: once only.
    const { pages } = threadPages.data;
    const threads = useMemo(() => mergePages(pages), [pages]);

    const latestMessages = api.useQueries((t) =>
        threads.map((thread) =>
            t.message.getLatestThreadMessage(
                { threadId: thread.id },
                {
                    initialData: initialThreads.find((initial) => initial.id === thread.id)?.lastMessage,
                    // Kept current by the open thread and by the effect below.
                    staleTime: Infinity,
                },
            ),
        ),
    );

    // After each refresh of the list, refetch the previews of exactly the
    // conversations it shows activity in (not all of them, every time).
    const previousThreads = useRef(threads);
    useEffect(() => {
        const active = threadsWithNewActivity(previousThreads.current, threads);
        previousThreads.current = threads;
        for (const threadId of active) void utils.message.getLatestThreadMessage.invalidate({ threadId });
    }, [threads, utils]);

    const { expectMore, listRef } = useFocusNewItems(threads.length);

    const conversations = sortThreadsByRecency(
        threads.map((thread, index) => ({
            ...thread,
            lastMessage: latestMessages[index]?.data ?? null,
        })),
    );

    if (conversations.length === 0) {
        return (
            <Box p="md">
                <EmptyState
                    icon={IconMessageCircle}
                    title="No conversations yet"
                    description="Start one with New message. You can write to photographers who are visible in Discover, and to anyone you've matched or booked with."
                />
            </Box>
        );
    }

    return (
        <Stack ref={listRef} component="ul" gap={0} m={0} p={0} style={{ listStyle: "none" }}>
            {conversations.map((conversation) => {
                const other = conversation.participants.find((participant) => participant.id !== currentUserId);
                if (!other) return null;
                const { lastMessage } = conversation;
                const isSelected = conversation.id === selectedThreadId;
                // The open conversation is being read: never shown as unread.
                const unread = isSelected ? 0 : conversation.unreadCount;
                const name = fullName(other);
                return (
                    <li key={conversation.id}>
                        <Link
                            href={`/app/messages/${conversation.id}`}
                            className={classes.row}
                            aria-current={isSelected ? "page" : undefined}
                            data-unread={unread > 0 ? true : undefined}
                            data-testid="conversation-row"
                        >
                            <Avatar size="md" src={other.profilePic} name={name} alt="" />
                            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                                <Group justify="space-between" wrap="nowrap" gap="xs">
                                    <Text fw={unread > 0 ? 700 : 600} size="sm" truncate>
                                        {name}
                                    </Text>
                                    {lastMessage && <Timemarker date={lastMessage.createdAt} />}
                                </Group>
                                <Group justify="space-between" wrap="nowrap" gap="xs">
                                    <Text
                                        size="xs"
                                        c={unread > 0 ? "var(--mantine-color-text)" : "dimmed"}
                                        fw={unread > 0 ? 600 : undefined}
                                        lineClamp={1}
                                        style={{ flex: 1, minWidth: 0 }}
                                    >
                                        {lastMessage
                                            ? `${lastMessage.sender.id === currentUserId ? "You: " : ""}${lastMessage.content}`
                                            : "No messages yet"}
                                    </Text>
                                    {unread > 0 && (
                                        <Badge size="sm" circle={unread < 10} style={{ flexShrink: 0 }} data-testid="conversation-unread">
                                            <span aria-hidden>{unreadBadgeLabel(unread)}</span>
                                            <span className="sr-only">{unreadMessagesLabel(unread)}</span>
                                        </Badge>
                                    )}
                                </Group>
                            </Stack>
                        </Link>
                    </li>
                );
            })}
            {threadPages.hasNextPage && (
                <Box component="li" p="sm" ta="center">
                    <Button
                        variant="default"
                        size="xs"
                        className="touch-target"
                        onClick={() => {
                            expectMore();
                            void threadPages.fetchNextPage();
                        }}
                        loading={threadPages.isFetchingNextPage}
                    >
                        Load older conversations
                    </Button>
                    {threadPages.isFetchNextPageError && (
                        <Text size="xs" c="red" mt={6} role="alert">
                            We couldn&apos;t load more conversations. Please try again.
                        </Text>
                    )}
                </Box>
            )}
        </Stack>
    );
}
