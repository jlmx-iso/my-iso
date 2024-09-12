"use client";
import { Loader, Stack } from "@mantine/core";
import { useState } from 'react';

import EventCard from "~/app/_components/events/EventCard";
import EventComment from "~/app/_components/events/EventComment";
import CommentsRefetchContext from "~/context/CommentsRefetchContext";
import { api } from "~/trpc/react";

export default function Page({ params }: { params: { id: string; }; }) {
    const [comments, setComments] = useState<typeof eventComments>([]);
    const { data: eventComments, refetch: refetchComments, isLoading } = api.event.getCommentsByEventId.useQuery({
        eventId: params.id
    }, {
        onSuccess: (data) => {
            setComments(data);
        }
    });

    const { data: commentCount, refetch: refetchCommentCount } = api.event.getCommentCountByEventId.useQuery({
        eventId: params.id
    });

    const handleRefetchComments = () => {
        // eslint-disable-next-line no-console
        refetchComments().catch(console.error);
    };

    const handleRefetchCommentCount = () => {
        // eslint-disable-next-line no-console
        refetchCommentCount().catch(console.error);
    };

    if (isLoading) {
        return <Loader />;
    }

    return (
        <CommentsRefetchContext.Provider value={{ refetchCommentCount: handleRefetchCommentCount, refetchComments: handleRefetchComments }}>
            <Stack gap="sm">
                <EventCard eventId={params.id} isEventPage={true} initialCommentCount={commentCount} />
                {comments?.map((comment) => (
                    <EventComment key={comment.id} comment={comment} />
                ))}
            </Stack>
        </CommentsRefetchContext.Provider>
    );
}