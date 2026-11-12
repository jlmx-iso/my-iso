"use client";

import { ActionIcon, Box, Button, Center, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { IconArrowDown, IconArrowLeft } from "@tabler/icons-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { fullName } from "~/_utils/names";
import { hasEarlierMessages, mergeThreadMessages, type ThreadMessage } from "~/_utils/threadMessages";
import { Avatar } from "~/app/_components/Avatar";
import { useMarkThreadRead } from "~/app/_hooks/useMarkThreadRead";
import { useMessageWebSocket } from "~/app/_hooks/useMessageWebSocket";
import { type RouterOutputs, api } from "~/trpc/react";

import ComposeMessage from "./ComposeMessage";
import MessageTile from "./MessageTile";

/** How often to refetch the thread while the realtime socket is not open. */
const POLL_INTERVAL_MS = 5_000;
/** The server just rendered the thread: no need to ask again on mount. */
const FRESH_FOR_MS = 10_000;
/** Within this distance of the bottom, new messages scroll into view by themselves. */
const NEAR_BOTTOM_PX = 120;

type MessageFeedProps = {
    threadId: string;
    /** The thread as the server page loaded it (its newest messages). */
    initialThread: NonNullable<RouterOutputs["message"]["getThreadById"]>;
};

/**
 * Renders one thread. Mount it with `key={threadId}` so that the messages
 * collected for one thread never carry over to another.
 */
export default function MessageFeed({ threadId, initialThread }: MessageFeedProps) {
    const session = useSession();
    const userId = session.data?.user.id;
    const utils = api.useUtils();
    const scrollerRef = useRef<HTMLDivElement>(null);

    const [hasUnseenMessages, setHasUnseenMessages] = useState(false);
    // Messages received over the socket or just sent from here. They are
    // merged with the query result below, so each message renders once and in
    // order no matter which of the two delivers it first.
    const [liveMessages, setLiveMessages] = useState<ThreadMessage[]>([]);
    // Pages loaded with "Load earlier messages".
    const [earlierMessages, setEarlierMessages] = useState<ThreadMessage[]>([]);
    const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
    const [loadEarlierFailed, setLoadEarlierFailed] = useState(false);
    const [reachedStart, setReachedStart] = useState(false);

    const isNearBottom = useCallback(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return true;
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX;
    }, []);

    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        scroller.scrollTo({ behavior, top: scroller.scrollHeight });
        setHasUnseenMessages(false);
    }, []);

    /** Keeps the conversation list's preview and order in step with this thread. */
    const publishLatest = useCallback((message: ThreadMessage) => {
        utils.message.getLatestThreadMessage.setData({ threadId }, (current) =>
            current && current.createdAt.getTime() > message.createdAt.getTime()
                ? current
                : { ...message, updatedAt: message.createdAt },
        );
    }, [threadId, utils]);

    const addLiveMessage = useCallback((message: ThreadMessage) => {
        setLiveMessages((current) => mergeThreadMessages(current, [message]));
        publishLatest(message);
    }, [publishLatest]);

    const realtimeStatus = useMessageWebSocket({
        onMessage: (message) => {
            const stickToBottom = isNearBottom();
            addLiveMessage(message);
            if (stickToBottom) {
                // Wait for the new tile to render before scrolling to it.
                requestAnimationFrame(() => scrollToBottom());
            } else if (message.sender.id !== userId) {
                setHasUnseenMessages(true);
            }
        },
        // Nothing is replayed after a gap in the connection: fetch what was missed.
        onOpen: () => void utils.message.getThreadById.invalidate({ threadId }),
        threadId,
    });

    // Poll while there is no socket (only while the tab is visible). `denied`
    // means the server refused this session or thread: polling cannot help.
    const shouldPoll = realtimeStatus !== "open" && realtimeStatus !== "denied";
    const { data, isPending, isError, refetch } = api.message.getThreadById.useQuery({ threadId }, {
        enabled: !!userId,
        initialData: initialThread,
        refetchInterval: shouldPoll ? POLL_INTERVAL_MS : false,
        refetchIntervalInBackground: false,
        staleTime: FRESH_FOR_MS,
    });

    const messages = useMemo(
        () => mergeThreadMessages(mergeThreadMessages(earlierMessages, data?.messages ?? []), liveMessages),
        [data?.messages, earlierMessages, liveMessages],
    );
    const latestMessage = messages[messages.length - 1];
    const latestMessageId = latestMessage?.id;

    // A polled message (no socket) also needs to reach the conversation list.
    useEffect(() => {
        if (latestMessage) publishLatest(latestMessage);
    }, [latestMessage, publishLatest]);

    // Start at the newest message.
    const hasLoaded = !!data;
    useLayoutEffect(() => {
        if (hasLoaded) scrollToBottom("auto");
    }, [hasLoaded, scrollToBottom]);

    // Polled messages: follow them when already at the bottom, flag them otherwise.
    const previousLatestId = useRef<string | undefined>(undefined);
    useEffect(() => {
        const previous = previousLatestId.current;
        previousLatestId.current = latestMessageId;
        if (!previous || !latestMessageId || previous === latestMessageId) return;
        const isFromOther = latestMessage?.sender.id !== userId;
        // Once the new tile has been laid out.
        const frame = requestAnimationFrame(() => {
            if (isNearBottom()) scrollToBottom();
            else if (isFromOther) setHasUnseenMessages(true);
        });
        return () => cancelAnimationFrame(frame);
    }, [isNearBottom, latestMessage, latestMessageId, scrollToBottom, userId]);

    // Read while it is on screen: clears the unread badge here and in the
    // navigation, now and for each message that arrives.
    useMarkThreadRead({ enabled: !!userId && hasLoaded, latestMessageId, threadId });

    const hasEarlier =
        !reachedStart &&
        hasEarlierMessages({
            shown: messages,
            snapshot: data?.messages ?? [],
            snapshotTotal: data?._count.messages ?? 0,
        });

    // Height of the list before older messages were prepended, so the view
    // can stay on the message the reader was looking at.
    const heightBeforePrepend = useRef<number | null>(null);
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        if (scroller && heightBeforePrepend.current !== null) {
            scroller.scrollTop += scroller.scrollHeight - heightBeforePrepend.current;
            heightBeforePrepend.current = null;
        }
    }, [earlierMessages]);

    const loadEarlier = async () => {
        setIsLoadingEarlier(true);
        setLoadEarlierFailed(false);
        try {
            // The server pages newest-first by offset: skipping what is already
            // here yields the page before it. Overlap is merged away by id.
            const page = await utils.message.getThreadById.fetch({ startAt: messages.length, threadId });
            const older = page?.messages ?? [];
            // Nothing came back although the count promised more (messages
            // were deleted meanwhile): stop offering.
            if (older.length === 0) setReachedStart(true);
            // The button may be gone after this: keep focus in the log.
            scrollerRef.current?.focus({ preventScroll: true });
            heightBeforePrepend.current = scrollerRef.current?.scrollHeight ?? null;
            setEarlierMessages((current) => mergeThreadMessages(current, older));
        } catch {
            setLoadEarlierFailed(true);
        } finally {
            setIsLoadingEarlier(false);
        }
    };

    const onSent = (message: ThreadMessage) => {
        addLiveMessage(message);
        // Wait for the new tile to render before scrolling to it.
        requestAnimationFrame(() => scrollToBottom());
    };

    const others = data?.participants.filter((participant) => participant.id !== userId) ?? [];
    const title = others
        .map((participant) => fullName(participant))
        .join(", ");
    const firstOther = others[0];

    if (!userId) {
        return null;
    }

    return (
        <Stack h="100%" w="100%" gap={0} style={{ minHeight: 0 }}>
            <Group
                gap="xs"
                px="sm"
                py="xs"
                wrap="nowrap"
                style={{ borderBottom: "1px solid var(--mantine-color-gray-3)", flexShrink: 0 }}
            >
                <ActionIcon
                    component={Link}
                    href="/app/messages"
                    variant="subtle"
                    color="gray"
                    size="lg"
                    hiddenFrom="md"
                    aria-label="Back to conversations"
                >
                    <IconArrowLeft size={20} />
                </ActionIcon>
                {firstOther && (
                    <Avatar src={firstOther.profilePic} name={title} alt="" size="sm" />
                )}
                {/* One line, cut with an ellipsis by the link (or text) itself: a
                    clamped heading would clip the link's enlarged hit area. */}
                <Title order={2} size="h5" style={{ flex: 1, minWidth: 0 }}>
                    {firstOther && others.length === 1 ? (
                        <Link href={`/app/photographer/${firstOther.id}`} className="ellipsis">{title}</Link>
                    ) : (
                        <span className="ellipsis">{title || "Conversation"}</span>
                    )}
                </Title>
            </Group>

            <Box pos="relative" style={{ flex: 1, minHeight: 0 }}>
                <Box
                    ref={scrollerRef}
                    h="100%"
                    px="xs"
                    py="sm"
                    style={{ display: "flex", flexDirection: "column", overflowY: "auto", overscrollBehavior: "contain" }}
                    onScroll={() => {
                        if (hasUnseenMessages && isNearBottom()) setHasUnseenMessages(false);
                    }}
                    tabIndex={0}
                    role="log"
                    aria-label={title ? `Messages with ${title}` : "Messages"}
                    data-testid="message-log"
                >
                    {/* `margin-top: auto` (not justify-content: flex-end) keeps a
                        short thread at the bottom without making the top of a
                        long one unreachable. */}
                    <Box mt="auto">
                        {isPending ? (
                            <Center py="xl"><Loader size="sm" aria-label="Loading messages" /></Center>
                        ) : isError ? (
                            <Stack align="center" gap="xs" py="xl">
                                <Text size="sm" c="red">We couldn&apos;t load this conversation.</Text>
                                <Button variant="default" size="xs" onClick={() => void refetch()}>Try again</Button>
                            </Stack>
                        ) : (
                            <>
                                {hasEarlier && (
                                    <Stack align="center" gap={4} pb="sm">
                                        <Button
                                            variant="default"
                                            size="xs"
                                            radius="xl"
                                            onClick={() => void loadEarlier()}
                                            loading={isLoadingEarlier}
                                        >
                                            Load earlier messages
                                        </Button>
                                        {loadEarlierFailed && (
                                            <Text size="xs" c="red" role="alert">
                                                Couldn&apos;t load earlier messages. Try again.
                                            </Text>
                                        )}
                                    </Stack>
                                )}
                                {messages.length === 0 && (
                                    <Text size="sm" c="dimmed" ta="center" py="xl">
                                        No messages yet. Say hello.
                                    </Text>
                                )}
                                {messages.map((message, index) => {
                                    const isLastInGroup = messages[index + 1]?.sender.id !== message.sender.id;
                                    return (
                                        <MessageTile
                                            key={message.id}
                                            message={message}
                                            isAuthor={message.sender.id === userId}
                                            isLastInGroup={isLastInGroup}
                                        />
                                    );
                                })}
                            </>
                        )}
                    </Box>
                </Box>

                {hasUnseenMessages && (
                    <Center pos="absolute" bottom={8} left={0} right={0} style={{ pointerEvents: "none" }}>
                        <Button
                            onClick={() => scrollToBottom()}
                            size="compact-sm"
                            radius="xl"
                            leftSection={<IconArrowDown size={14} />}
                            style={{ boxShadow: "var(--mantine-shadow-md)", pointerEvents: "auto" }}
                        >
                            New messages
                        </Button>
                    </Center>
                )}
            </Box>

            <Box px="sm" pb="sm" style={{ flexShrink: 0 }}>
                <ComposeMessage
                    threadId={threadId}
                    onSent={onSent}
                    // Until the member has written something themselves.
                    suggestStarters={hasLoaded && !messages.some((message) => message.sender.id === userId)}
                />
            </Box>
        </Stack>
    );
}
