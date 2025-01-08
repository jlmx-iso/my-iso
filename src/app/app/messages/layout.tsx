import { Center, Container, Grid, GridCol, Group } from "@mantine/core";
import Link from "next/link";

import ConversationTile from "./_components/ConversationTile";
import NewMessageModal from "./_components/NewMessageModal";

import { logger } from "~/_utils";
import PageHeading from "~/app/_components/PageHeading";
import { getServerAuthSession } from "~/server/auth";
import { api } from "~/trpc/server";

interface LayoutProps {
    children: React.ReactNode;
    params?: Record<string, string>;
}

export default async function Layout({ children, params }: LayoutProps) {
    const session = await getServerAuthSession();
    if (!session?.user) return null;

    const data = await api.message.getThreadsByUserId.query();

    logger.info("params", { params });
    return (
        <Container h="calc(100vh - 14rem)" pos="relative">
            <Grid w="100%" mih="100%" pos="relative" display="flex" align="stretch">
                <GridCol span={5} style={{ borderRight: "2px solid" }}>
                    <PageHeading>Messages</PageHeading>
                    <Group w="100%" justify="center">
                        <NewMessageModal />
                    </Group>
                    <Container p="xl">
                        {data?.map((messageThread) => {
                            const participants = messageThread.participants.filter((participant) => participant.id !== session.user.id);
                            return (
                                <Link key={messageThread.id} href={`/app/messages/${messageThread.id}`}>
                                    {participants.map(p => (
                                        <ConversationTile
                                            isCurrentConversation={params?.id === messageThread.id}
                                            key={p.id}
                                            threadId={messageThread.id}
                                            recipient={p}
                                        />
                                    ))}
                                </Link>
                            )
                        })}
                    </Container>
                </GridCol>
                {/* <Divider orientation="vertical" /> */}
                <GridCol span={7}>
                    <Center style={{ height: "100%" }}>
                        {children}
                    </Center>
                </GridCol>
            </Grid>
        </Container>
    )
}