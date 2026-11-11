import { Box, Grid, GridCol, ScrollArea, Stack } from "@mantine/core";
import { IconMessageCircle } from "@tabler/icons-react";
import Link from "next/link";
import { Suspense } from "react";

import ConversationTile from "./_components/ConversationTile";
import NewMessageModal from "./_components/NewMessageModal";

import EmptyState from "~/app/_components/EmptyState";
import PageHeader from "~/app/_components/PageHeader";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

interface LayoutProps {
    children: React.ReactNode;
    params?: Promise<Record<string, string>>;
}

export default async function Layout({ children, params }: LayoutProps) {
    const resolvedParams = params ? await params : undefined;
    const session = await auth();
    if (!session?.user) return null;

    const data = await (await api()).message.getThreadsByUserId();
    const hasActiveThread = !!resolvedParams?.id;

    return (
        <Stack gap="lg" h="calc(100dvh - 60px - var(--mantine-spacing-md) * 2)">
            <style>{`
                @media (max-width: 61.99em) {
                    ${hasActiveThread
                        ? '.messages-sidebar { display: none !important; }'
                        : '.messages-chat { display: none !important; }'
                    }
                }
            `}</style>
            <PageHeader
                title="Messages"
                action={<Suspense><NewMessageModal /></Suspense>}
            />
            <Grid
                gutter={0}
                styles={{ inner: { height: "100%" } }}
                style={{
                    flex: 1,
                    overflow: "hidden",
                    borderRadius: "var(--mantine-radius-md)",
                    border: "1px solid var(--mantine-color-gray-3)",
                }}
            >
                <GridCol
                    span={{ base: 12, md: 4 }}
                    className="messages-sidebar"
                    style={{
                        borderRight: "1px solid var(--mantine-color-gray-3)",
                    }}
                >
                    <ScrollArea h="100%" type="auto">
                        <Stack gap={0}>
                            {data?.length ? (
                                data.map((messageThread) => {
                                    const otherParticipants = messageThread.participants.filter(
                                        (participant) => participant.id !== session.user.id
                                    );
                                    const firstParticipant = otherParticipants[0];
                                    if (!firstParticipant) return null;
                                    return (
                                        <Link
                                            key={messageThread.id}
                                            href={`/app/messages/${messageThread.id}`}
                                            style={{ textDecoration: "none", color: "inherit" }}
                                        >
                                            <ConversationTile
                                                isCurrentConversation={resolvedParams?.id === messageThread.id}
                                                threadId={messageThread.id}
                                                recipient={firstParticipant}
                                            />
                                        </Link>
                                    );
                                })
                            ) : (
                                <Box p="xl">
                                    <EmptyState
                                        icon={IconMessageCircle}
                                        title="No conversations"
                                        description="Start a new message to connect with photographers."
                                    />
                                </Box>
                            )}
                        </Stack>
                    </ScrollArea>
                </GridCol>
                <GridCol
                    span={{ base: 12, md: 8 }}
                    className="messages-chat"
                    pos="relative"
                >
                    <Box pos="absolute" style={{ inset: 0, display: "flex", flexDirection: "column" }}>
                        {children}
                    </Box>
                </GridCol>
            </Grid>
        </Stack>
    )
}
