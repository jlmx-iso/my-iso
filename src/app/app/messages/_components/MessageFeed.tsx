"use client";

import { ActionIcon, Box, Group, Stack, Text, VisuallyHidden } from "@mantine/core";
import { useDocumentVisibility, useScrollIntoView } from "@mantine/hooks";
import { IconArrowLeft } from "@tabler/icons-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { mergeThreadMessages, type ThreadMessage } from "~/_utils/threadMessages";
import ScrollButton from "~/app/_components/buttons/ScrollButton";
import { useMessageWebSocket } from "~/app/_hooks/useMessageWebSocket";
import { api } from "~/trpc/react";

import ComposeMessage from "./ComposeMessage";
import { markReadRetryDelayMs } from "./markReadRetry";
import MessageTile from "./MessageTile";

/** How often to refetch the thread while the realtime socket is not open. */
const POLL_INTERVAL_MS = 5_000;

/** At most one markThreadRead per this long (its limit is 120 a minute). */
const MARK_READ_MIN_INTERVAL_MS = 3_000;

/**
 * The newest message this tab has already marked read, per user and thread,
 * so that coming back to a thread with nothing new sends nothing.
 */
const markedReadKey = (userId: string, threadId: string) => `iso:marked-read:${userId}:${threadId}`;

function getMarkedRead(key: string): string | null {
    try {
        return window.sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function setMarkedRead(key: string, messageId: string) {
    try {
        window.sessionStorage.setItem(key, messageId);
    } catch {
        // Storage unavailable: the call is only repeated on the next visit.
    }
}

type MessageFeedProps = {
    threadId: string;
};

/**
 * Renders one thread. Mount it with `key={threadId}` so that the messages
 * collected for one thread never carry over to another.
 */
export default function MessageFeed({ threadId }: MessageFeedProps) {
    const { scrollIntoView, targetRef, scrollableRef } = useScrollIntoView<HTMLDivElement>({
        offset: 60,
    });
    const session = useSession();
    const userId = session.data?.user.id;
    const utils = api.useUtils();

    const [isScrollButtonHidden, setIsScrollButtonHidden] = useState(true);
    // Messages received over the socket or just sent from here. They are
    // merged with the query result below, so each message renders once and in
    // order no matter which of the two delivers it first.
    const [liveMessages, setLiveMessages] = useState<ThreadMessage[]>([]);

    const addLiveMessage = useCallback((message: ThreadMessage) => {
        setLiveMessages((current) => mergeThreadMessages(current, [message]));
    }, []);

    const realtimeStatus = useMessageWebSocket({
        onMessage: (message) => {
            addLiveMessage(message);
            if (message.sender.id !== userId) {
                setIsScrollButtonHidden(false);
            }
        },
        // Nothing is replayed after a gap in the connection: fetch what was missed.
        onOpen: () => void utils.message.getThreadById.invalidate({ threadId }),
        threadId,
    });

    const { data } = api.message.getThreadById.useQuery({ threadId }, {
        enabled: !!userId,
        // Without an open socket, poll instead (only while the tab is visible).
        refetchInterval: realtimeStatus === "open" ? false : POLL_INTERVAL_MS,
        refetchIntervalInBackground: false,
    });

    const messages = useMemo(
        () => mergeThreadMessages(data?.messages ?? [], liveMessages),
        [data?.messages, liveMessages],
    );

    // Mark the thread read up to the newest message rendered here: once it
    // has loaded, and again when a message arrives while it is open. Only
    // while the tab is visible, at most once per MARK_READ_MIN_INTERVAL_MS
    // (a burst of messages is one call, for the last of them), and never
    // twice for the same message once it has SUCCEEDED. A call that fails
    // is tried again while the thread stays open, after a growing delay and
    // a bounded number of times (markReadRetryDelayMs): otherwise the
    // unread badge would stay until another message arrived.
    const isThreadLoaded = data != null;
    const newestMessageId = messages.at(-1)?.id;
    const isDocumentVisible = useDocumentVisibility() === "visible";
    const lastMarkReadAttempt = useRef<{ at: number; failed: boolean; messageId: string } | null>(null);
    const markReadFailures = useRef(0);
    const markReadRetryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [markReadRetry, setMarkReadRetry] = useState(0);
    const { mutate: markThreadRead } = api.message.markThreadRead.useMutation({
        onError: (_error, variables) => {
            markReadFailures.current += 1;
            const delay = markReadRetryDelayMs(markReadFailures.current);
            if (delay === null) return;
            clearTimeout(markReadRetryTimer.current);
            markReadRetryTimer.current = setTimeout(() => {
                const last = lastMarkReadAttempt.current;
                // Still the attempt that failed (no newer message took over): let the effect make it again.
                if (last && last.messageId === variables.upToMessageId) last.failed = true;
                setMarkReadRetry((count) => count + 1);
            }, delay);
        },
        onSuccess: (_result, variables) => {
            markReadFailures.current = 0;
            if (userId && variables.upToMessageId) {
                setMarkedRead(markedReadKey(userId, threadId), variables.upToMessageId);
            }
            void utils.message.getThreadsByUserId.invalidate();
            void utils.message.getThreadsPage.invalidate();
            void utils.message.getUnreadCount.invalidate();
        },
    });

    useEffect(() => {
        if (!userId || !isThreadLoaded || !newestMessageId || !isDocumentVisible) return;
        const last = lastMarkReadAttempt.current;
        if (last?.messageId === newestMessageId && !last.failed) return;
        if (getMarkedRead(markedReadKey(userId, threadId)) === newestMessageId) return;

        const wait = last ? Math.max(0, last.at + MARK_READ_MIN_INTERVAL_MS - Date.now()) : 0;
        const timer = setTimeout(() => {
            lastMarkReadAttempt.current = { at: Date.now(), failed: false, messageId: newestMessageId };
            markThreadRead({ threadId, upToMessageId: newestMessageId });
        }, wait);
        return () => clearTimeout(timer);
    }, [isDocumentVisible, isThreadLoaded, markReadRetry, markThreadRead, newestMessageId, threadId, userId]);

    // No retry outlives the open thread.
    useEffect(() => () => clearTimeout(markReadRetryTimer.current), [threadId]);

    const hideScrollButton = () => setIsScrollButtonHidden(true);

    const scrollToBottom = () => {
        scrollIntoView({ alignment: "end" });
        hideScrollButton();
    };

    const onSent = (message: ThreadMessage) => {
        addLiveMessage(message);
        // Wait for the new tile to render before scrolling to it.
        requestAnimationFrame(scrollToBottom);
    };

    const title = data?.participants
        .filter(p => p.id !== userId)
        .map(p => `${p.firstName || ""} ${p.lastName || ""}`.trim() || "User")
        .join(", ");

    if (!userId) {
        return null;
    }

    return (
        <Stack h="100%" w="100%" gap={0}>
            {/* Header */}
            <Box px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-gray-2)" }}>
                <Group gap="xs">
                    <ActionIcon
                        component={Link}
                        href="/app/messages"
                        variant="subtle"
                        color="gray"
                        hiddenFrom="md"
                        aria-label="Back to conversations"
                    >
                        <IconArrowLeft size={18} />
                    </ActionIcon>
                    <Text fw={600} size="md">
                        {title}
                    </Text>
                </Group>
            </Box>

            {/* Messages area */}
            <Box pos="relative" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <Stack
                    gap={0}
                    h="100%"
                    style={{ overflowY: "auto", justifyContent: "flex-end" }}
                    ref={scrollableRef}
                    px="xs"
                    py="sm"
                >
                    {messages.map((message, index) => {
                        const isLastInGroup = messages[index + 1]?.sender.id !== message.sender.id;
                        return (
                            <MessageTile
                                key={message.id}
                                message={message}
                                isAuthor={message.sender.id === userId}
                                showTimestamp={isLastInGroup}
                                isLastInGroup={isLastInGroup}
                            />
                        );
                    })}
                    <VisuallyHidden ref={targetRef}>End of thread</VisuallyHidden>
                </Stack>

                {/* Scroll button — positioned inside the message area but above the feed */}
                <ScrollButton hide={isScrollButtonHidden} onClick={scrollToBottom}>
                    New Messages
                </ScrollButton>
            </Box>

            {/* Compose */}
            <Box px="md" pb="md">
                <ComposeMessage threadId={threadId} onSent={onSent} />
            </Box>
        </Stack>
    );
}
