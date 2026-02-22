"use client";

import { ActionIcon, Box, Group, Stack, Text, VisuallyHidden } from "@mantine/core";
import { useScrollIntoView } from "@mantine/hooks";
import { IconArrowLeft } from "@tabler/icons-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";

import ComposeMessage from "./ComposeMessage";
import MessageListener from "./MessageListener";
import MessageTile from "./MessageTile";

import ScrollButton from "~/app/_components/buttons/ScrollButton";
import { api } from "~/trpc/react";

type MessageFeedProps = {
    threadId: string;
};

export default function MessageFeed({ threadId }: MessageFeedProps) {
    const { scrollIntoView, targetRef, scrollableRef } = useScrollIntoView<HTMLDivElement>({
        offset: 60,
    });
    const session = useSession()
    const userId = session.data?.user.id;

    const [isScrollButtonHidden, setIsScrollButtonHidden] = useState(true);

    const { data } = api.message.getThreadById.useQuery({ threadId }, { enabled: !!userId });
    const messages = data?.messages ?? [];

    const hideScrollButton = () => setIsScrollButtonHidden(true);
    const showScrollButton = () => setIsScrollButtonHidden(false);

    const scrollToBottom = () => {
        scrollIntoView({ alignment: "end" });
        hideScrollButton();
    };

    const onNewMessage = () => {
        showScrollButton();
    };

    const title = data?.participants
        .filter(p => p.id !== userId)
        .map(p => `${p.firstName} ${p.lastName}`)
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
                    <MessageListener threadId={threadId} userId={userId} newMessageCb={onNewMessage} />
                    {messages.map((message, index) => {
                        const nextMessage = messages[index + 1];
                        const isLastInGroup = !nextMessage || nextMessage.sender.id !== message.sender.id;
                        return (
                            <MessageTile
                                key={message.id}
                                message={{
                                    ...message,
                                    isAuthor: userId === message.sender.id,
                                    senderId: message.sender.id
                                }}
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
                <ComposeMessage threadId={threadId} />
            </Box>
        </Stack>
    )
}
