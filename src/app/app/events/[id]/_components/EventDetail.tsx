"use client";

import { Alert, Anchor, Button, Divider, Group, Skeleton, Stack, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";
import Link from "next/link";

import AddCommentForm from "~/app/_components/AddCommentForm";
import EventCard from "~/app/_components/events/EventCard";
import EventComment from "~/app/_components/events/EventComment";
import { api } from "~/trpc/react";

type EventDetailProps = {
    eventId: string;
    eventTitle: string;
};

/** One event with its comments and the comment form. */
export default function EventDetail({ eventId, eventTitle }: EventDetailProps) {
    const comments = api.event.getCommentsByEventId.useQuery({ eventId });
    const commentCount = comments.data?.length ?? 0;

    return (
        <Stack gap="md" maw={760} mx="auto">
            <Anchor component={Link} href="/app/events" c="dimmed" size="sm" w="fit-content">
                <Group gap={4} wrap="nowrap"><IconArrowLeft size={14} aria-hidden /> Back to events</Group>
            </Anchor>

            <EventCard eventId={eventId} isEventPage />

            <Divider />

            <Stack gap="xs" component="section" aria-labelledby="comments-heading">
                <Title order={2} size="h5" id="comments-heading">
                    Comments{commentCount ? ` (${commentCount})` : ""}
                </Title>

                {comments.isPending ? (
                    <Stack gap="sm" aria-busy="true" aria-label="Loading comments">
                        <Skeleton height={56} radius="md" />
                        <Skeleton height={56} radius="md" />
                    </Stack>
                ) : comments.isError ? (
                    <Alert color="red" icon={<IconAlertCircle size={16} />} title="We couldn't load comments">
                        <Button variant="default" size="xs" mt="xs" onClick={() => void comments.refetch()}>
                            Try again
                        </Button>
                    </Alert>
                ) : commentCount === 0 ? (
                    <Text c="dimmed" size="sm">No comments yet. Ask a question or say you&apos;re interested.</Text>
                ) : (
                    <Stack gap={0} component="ul" m={0} p={0} aria-label="Comments">
                        {comments.data.map((comment) => (
                            <EventComment key={comment.id} comment={comment} />
                        ))}
                    </Stack>
                )}

                <AddCommentForm eventId={eventId} eventTitle={eventTitle} />
            </Stack>
        </Stack>
    );
}
