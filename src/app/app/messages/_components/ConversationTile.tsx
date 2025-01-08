import { Group, Stack, Text, Title } from "@mantine/core";

import { type Recipient } from "./NewMessageModal";

import ProfileAvatar from "~/app/_components/profiles/ProfileAvatar";
import Timemarker from "~/app/_components/Timemarker";
import colors from "~/app/theme/colors";
import { api } from "~/trpc/server";

type ConversationTileProps = {
    threadId: string;
    recipient: Recipient;
    isCurrentConversation: boolean;
};

export default async function ConversationTile({ threadId, recipient, isCurrentConversation }: ConversationTileProps) {
    const lastMessage = await api.message.getLatestThreadMessage.query({ threadId });
    return (
        <Group wrap="nowrap" bg={isCurrentConversation ? "blue" : "transparent"}>
            <ProfileAvatar size="md" avatar={recipient.profilePic} name={`${recipient.firstName} ${recipient.lastName}`} isSelf={false} />
            <Stack>
                <Group justify="space-between">
                    <Title order={3} fw="600">{`${recipient.firstName} ${recipient.lastName}`}</Title>
                    {lastMessage && <Timemarker date={lastMessage.updatedAt} />}
                </Group>
                {lastMessage &&
                    <Text mt="-1rem" c={colors.gray?.[7]} size="sm" fs="italic">{lastMessage.content}</Text>
                }
            </Stack>
        </Group>

    )
}