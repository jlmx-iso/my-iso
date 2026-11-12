"use client";

import { Box, Group, Stack, Text } from "@mantine/core";
import { IconMessageCircle } from "@tabler/icons-react";
import Link from "next/link";

import { sortThreadsByRecency } from "~/_utils/messagePanes";
import { Avatar } from "~/app/_components/Avatar";
import EmptyState from "~/app/_components/EmptyState";
import Timemarker from "~/app/_components/Timemarker";
import { type RouterOutputs, api } from "~/trpc/react";

import classes from "./MessagesShell.module.css";

type Thread = RouterOutputs["message"]["getThreadsByUserId"][number];
type LatestMessage = RouterOutputs["message"]["getLatestThreadMessage"];

export type ConversationSummary = Thread & { lastMessage: LatestMessage };

type ConversationListProps = {
    initialThreads: ConversationSummary[];
    currentUserId: string;
    selectedThreadId: string | null;
};

/** How often to look for new threads and for new messages in each thread. */
const THREADS_POLL_MS = 30_000;
const PREVIEW_POLL_MS = 15_000;

const fullName = (person: { firstName: string; lastName: string }) =>
    `${person.firstName || ""} ${person.lastName || ""}`.trim() || "ISO member";

/**
 * Conversation list, most recent first. Previews and order follow the
 * `getLatestThreadMessage` cache, which the open thread updates as messages
 * are sent or arrive, and which is polled for the other threads.
 */
export default function ConversationList({ initialThreads, currentUserId, selectedThreadId }: ConversationListProps) {
    const { data: threads } = api.message.getThreadsByUserId.useQuery(undefined, {
        initialData: initialThreads.map(({ id, participants }) => ({ id, participants })),
        refetchInterval: THREADS_POLL_MS,
        refetchIntervalInBackground: false,
    });

    const latestMessages = api.useQueries((t) =>
        threads.map((thread) =>
            t.message.getLatestThreadMessage(
                { threadId: thread.id },
                {
                    initialData: initialThreads.find((initial) => initial.id === thread.id)?.lastMessage,
                    refetchInterval: PREVIEW_POLL_MS,
                    refetchIntervalInBackground: false,
                },
            ),
        ),
    );

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
                    description="Message a photographer from their profile, or start one with New message."
                />
            </Box>
        );
    }

    return (
        <Stack component="ul" gap={0} m={0} p={0} style={{ listStyle: "none" }}>
            {conversations.map((conversation) => {
                const other = conversation.participants.find((participant) => participant.id !== currentUserId);
                if (!other) return null;
                const { lastMessage } = conversation;
                const isSelected = conversation.id === selectedThreadId;
                return (
                    <li key={conversation.id}>
                        <Link
                            href={`/app/messages/${conversation.id}`}
                            className={classes.row}
                            aria-current={isSelected ? "page" : undefined}
                            data-testid="conversation-row"
                        >
                            <Avatar size="md" src={other.profilePic} name={fullName(other)} alt="" />
                            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                                <Group justify="space-between" wrap="nowrap" gap="xs">
                                    <Text fw={600} size="sm" truncate>
                                        {fullName(other)}
                                    </Text>
                                    {lastMessage && <Timemarker date={lastMessage.createdAt} />}
                                </Group>
                                <Text size="xs" c="dimmed" lineClamp={1}>
                                    {lastMessage
                                        ? `${lastMessage.sender.id === currentUserId ? "You: " : ""}${lastMessage.content}`
                                        : "No messages yet"}
                                </Text>
                            </Stack>
                        </Link>
                    </li>
                );
            })}
        </Stack>
    );
}
