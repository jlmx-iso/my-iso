import { Box, Group, Stack, Text } from "@mantine/core";

import { type Recipient } from "./NewMessageModal";

import { Avatar } from "~/app/_components/Avatar";
import Timemarker from "~/app/_components/Timemarker";
import { api } from "~/trpc/server";

type ConversationTileProps = {
    threadId: string;
    recipient: Recipient;
    isCurrentConversation: boolean;
};

export default async function ConversationTile({ threadId, recipient, isCurrentConversation }: ConversationTileProps) {
    const lastMessage = await (await api()).message.getLatestThreadMessage({ threadId });
    return (
        <Box
            px="md"
            py="sm"
            style={{
                backgroundColor: isCurrentConversation
                    ? "var(--mantine-color-orange-0)"
                    : "transparent",
                borderLeft: isCurrentConversation
                    ? "3px solid var(--mantine-color-orange-5)"
                    : "3px solid transparent",
                transition: "background-color 150ms ease",
                cursor: "pointer",
            }}
        >
            <Group wrap="nowrap" gap="sm">
                <Avatar
                    size="md"
                    src={recipient.profilePic}
                    name={`${recipient.firstName} ${recipient.lastName}`}
                />
                <Stack gap={2} style={{ flex: 1, overflow: "hidden" }}>
                    <Group justify="space-between" wrap="nowrap">
                        <Text fw={600} size="sm" truncate>
                            {recipient.firstName} {recipient.lastName}
                        </Text>
                        {lastMessage && (
                            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                                <Timemarker date={lastMessage.updatedAt} />
                            </Text>
                        )}
                    </Group>
                    {lastMessage && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                            {lastMessage.isEncrypted ? "Encrypted message" : lastMessage.content}
                        </Text>
                    )}
                </Stack>
            </Group>
        </Box>
    )
}
