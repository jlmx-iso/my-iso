"use client";

import { ActionIcon, Box, Group, Stack, Text, VisuallyHidden } from "@mantine/core";
import { useScrollIntoView } from "@mantine/hooks";
import { IconArrowLeft } from "@tabler/icons-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

import ComposeMessage from "./ComposeMessage";
import MessageListener from "./MessageListener";
import MessageTile from "./MessageTile";

import { useE2EE } from "~/app/_hooks/useE2EE";
import ScrollButton from "~/app/_components/buttons/ScrollButton";
import { api } from "~/trpc/react";

type DecryptedMessage = {
  content: string;
  createdAt: Date;
  id: string;
  isAuthor: boolean;
  senderId: string;
};

type MessageFeedProps = {
    threadId: string;
};

export default function MessageFeed({ threadId }: MessageFeedProps) {
    const { scrollIntoView, targetRef, scrollableRef } = useScrollIntoView<HTMLDivElement>({
        offset: 60,
    });
    const session = useSession();
    const userId = session.data?.user.id;

    const [isScrollButtonHidden, setIsScrollButtonHidden] = useState(true);
    const [decryptedMessages, setDecryptedMessages] = useState<DecryptedMessage[]>([]);

    const { data } = api.message.getThreadById.useQuery({ threadId }, { enabled: !!userId });
    const messages = data?.messages ?? [];

    const { decryptForThread, ready: e2eeReady } = useE2EE();

    // Decrypt messages from tRPC query when they load or E2EE becomes ready
    useEffect(() => {
        if (!e2eeReady || !userId || messages.length === 0) return;

        const encryptedThreadKey = data?.threadKeys?.[0]?.encryptedKey;

        async function decryptAll() {
            const results = await Promise.all(
                messages.map(async (msg) => {
                    const content = msg.isEncrypted
                        ? await decryptForThread(threadId, msg.content, encryptedThreadKey)
                        : msg.content;
                    return {
                        content,
                        createdAt: msg.createdAt,
                        id: msg.id,
                        isAuthor: userId === msg.sender.id,
                        senderId: msg.sender.id,
                    };
                }),
            );
            setDecryptedMessages(results);
        }

        void decryptAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [e2eeReady, messages, threadId, userId]);

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

    // Use decrypted messages when E2EE is ready, fall back to raw content
    const displayMessages: DecryptedMessage[] = e2eeReady
        ? decryptedMessages
        : messages.map((msg) => ({
            content: msg.content,
            createdAt: msg.createdAt,
            id: msg.id,
            isAuthor: userId === msg.sender.id,
            senderId: msg.sender.id,
          }));

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
                    {displayMessages.map((message, index) => {
                        const nextMessage = displayMessages[index + 1];
                        const isLastInGroup = !nextMessage || nextMessage.senderId !== message.senderId;
                        return (
                            <MessageTile
                                key={message.id}
                                message={message}
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
    );
}
