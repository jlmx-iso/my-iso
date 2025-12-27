"use client";

import { Flex, VisuallyHidden, Container } from "@mantine/core";
import { useScrollIntoView } from "@mantine/hooks";
import { useSession } from "next-auth/react";
import { useState } from "react";

import ComposeMessage from "./ComposeMessage";
import MessageListener from "./MessageListener";
import MessageTile from "./MessageTile";

import ScrollButton from "~/app/_components/buttons/ScrollButton";
import PageHeading from "~/app/_components/PageHeading";
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

    if (!userId) {
        return null;
    }

    const [isScrollButtonHidden, setIsScrollButtonHidden] = useState(false);

    const { data } = api.message.getThreadById.useQuery({ threadId });
    const { messages } = data ?? { messages: [] };

    const hideScrollButton = () => setIsScrollButtonHidden(true);
    const showScrollButton = () => setIsScrollButtonHidden(false);

    const scrollToBottom = () => {
        scrollIntoView({ alignment: "end" });
        hideScrollButton();
    };

    const onNewMessage = () => {
        showScrollButton();
    };

    const title = data?.participants.filter(p => p.id !== userId).map(p => p.firstName + " " + p.lastName).join(", ");

    return (
        <Container h="calc(100vh - 14rem)" pos="relative" w="100%">
            <PageHeading>
                {title}
            </PageHeading>

            <Flex
                h="100%"
                w="100%"
                direction="column-reverse"
                style={{ overflowAnchor: "none", overflowY: "scroll" }}
                ref={scrollableRef}
                display={"flex"}
                pos="relative"
            >
                <VisuallyHidden ref={targetRef}>End of thread</VisuallyHidden>
                <MessageListener threadId={threadId} userId={userId} newMessageCb={onNewMessage} />
                {messages.map((message: any) => (
                    <MessageTile
                        key={message.id}
                        message={{
                            ...message,
                            isAuthor: userId === message.sender.id,
                            senderId: message.sender.id
                        }} />
                ))}
                <ScrollButton hide={isScrollButtonHidden} onClick={scrollToBottom}>
                    New Message(s)
                </ScrollButton>
            </Flex>
            <ComposeMessage threadId={threadId} />
        </Container>
    )
};