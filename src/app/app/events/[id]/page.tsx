"use client";
import { Anchor, Group, Loader, Stack, Text } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { use, useEffect, useState } from 'react';
import Link from "next/link";

import AddCommentForm from "~/app/_components/AddCommentForm";
import EventCard from "~/app/_components/events/EventCard";
import EventComment from "~/app/_components/events/EventComment";
import CommentsRefetchContext from "~/context/CommentsRefetchContext";
import { logger } from "~/_utils";
import { api } from "~/trpc/react";

export default function Page({ params }: { params: Promise<{ id: string }>; }) {
    const { id } = use(params);
    const [comments, setComments] = useState<typeof eventComments>([]);
    const { data: eventComments, refetch: refetchComments, isPending } = api.event.getCommentsByEventId.useQuery({
        eventId: id
    });

    useEffect(() => {
        if (eventComments) {
            setComments(eventComments);
        }
    }, [eventComments]);

    const { data: commentCount, refetch: refetchCommentCount } = api.event.getCommentCountByEventId.useQuery({
        eventId: id
    });

    const handleRefetchComments = () => {
        refetchComments().catch((err) => logger.error('Failed to refetch comments', { error: err }));
    };

    const handleRefetchCommentCount = () => {
        refetchCommentCount().catch((err) => logger.error('Failed to refetch comment count', { error: err }));
    };

    if (isPending) {
        return <Loader />;
    }

    return (
        <CommentsRefetchContext.Provider value={{ refetchCommentCount: handleRefetchCommentCount, refetchComments: handleRefetchComments }}>
            <Stack gap="md">
                <Anchor component={Link} href="/app/events" c="dimmed" size="sm">
                    <Group gap={4}><IconArrowLeft size={14} /> Back to Events</Group>
                </Anchor>
                <EventCard eventId={id} isEventPage={true} hideCompose={true} initialCommentCount={commentCount} />
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 1 }}>
                    Comments{commentCount ? ` (${commentCount})` : ""}
                </Text>
                <Stack gap={0}>
                    {comments?.map((comment: any) => (
                        <EventComment key={comment.id} comment={comment} />
                    ))}
                </Stack>
                <AddCommentForm eventId={id} />
            </Stack>
        </CommentsRefetchContext.Provider>
    );
}