"use client";

import { ActionIcon, Box, Group, Stack, Text, VisuallyHidden } from "@mantine/core";
import { useScrollIntoView } from "@mantine/hooks";
import { IconArrowLeft } from "@tabler/icons-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useMemo, useState } from "react";

import { mergeThreadMessages, type ThreadMessage } from "~/_utils/threadMessages";
import ScrollButton from "~/app/_components/buttons/ScrollButton";
import { useMessageWebSocket } from "~/app/_hooks/useMessageWebSocket";
import { api } from "~/trpc/react";

import ComposeMessage from "./ComposeMessage";
import MessageTile from "./MessageTile";

/** How often to refetch the thread while the realtime socket is not open. */
const POLL_INTERVAL_MS = 5_000;

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
