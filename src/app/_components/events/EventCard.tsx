"use client";

import { Badge, Box, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { IconMessageCircle } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";

import type { Application } from "~/_utils/bookings";
import type { RouterOutputs } from "~/trpc/react";

import AddCommentForm from "../AddCommentForm";
import Timemarker from "../Timemarker";
import UserBadge from "../UserBadge";
import ApplyAction from "./ApplyAction";
import EventCover from "./EventCover";
import EventMeta from "./EventMeta";

export type FeedEvent = RouterOutputs["event"]["getFeedPage"]["items"][number];

type EventCardProps = {
    /** A row of the feed: everything the card shows is already in it. */
    event: FeedEvent;
    /** The viewer's application to this event; undefined while loading. */
    application: Application | undefined;
    currentUserId: string;
    /** The feed's clock (see useNow), so every card agrees on what is past. */
    now: Date;
};

/** One event in the feed. Renders from the feed row: no request of its own. */
export default function EventCard({ event, application, currentUserId, now }: EventCardProps) {
    const [isCommentFormOpen, setIsCommentFormOpen] = useState(false);
    // Comments posted from this card since the feed row was loaded.
    const [postedHere, setPostedHere] = useState(0);
    const commentCount = event.commentCount + postedHere;
    const href = `/app/events/${event.id}`;
    const isPast = new Date(event.date).getTime() < now.getTime();

    return (
        <Card
            component="article"
            className="card-interactive"
            shadow="xs"
            p={0}
            radius="md"
            withBorder
            h="100%"
            style={{ borderLeft: "3px solid var(--mantine-color-orange-3)" }}
            data-testid="event-card"
        >
            {event.image && (
                // The title below links to the same page; this link is a
                // bigger pointer target only.
                <Link href={href} tabIndex={-1} aria-hidden="true">
                    <EventCover src={event.image} h={180} />
                </Link>
            )}

            <Stack gap="xs" p="md" style={{ flex: 1 }}>
                <Group justify="space-between" align="center" wrap="nowrap">
                    <UserBadge user={event.photographer} />
                    <Timemarker date={event.createdAt} />
                </Group>

                <Box>
                    <Title order={3} size="h4" mb={2} style={{ overflowWrap: "anywhere" }}>
                        <Link href={href}>{event.title}</Link>
                    </Title>
                    {event.description && (
                        <Text c="dimmed" size="sm" lineClamp={2}>{event.description}</Text>
                    )}
                </Box>

                <Group gap="xs">
                    <EventMeta date={event.date} duration={event.duration} location={event.location} />
                    {isPast && <Badge variant="light" color="gray">Past event</Badge>}
                </Group>

                <Group gap="xs" justify="space-between" align="center" mt="auto" pt={4}>
                    <Button
                        variant="subtle"
                        color="gray"
                        size="compact-sm"
                        className="touch-target"
                        leftSection={<IconMessageCircle size={16} aria-hidden />}
                        aria-expanded={isCommentFormOpen}
                        aria-label={`Comment on ${event.title}, ${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
                        onClick={() => setIsCommentFormOpen((open) => !open)}
                        data-testid="event-card-comments"
                    >
                        {commentCount}
                    </Button>
                    <ApplyAction
                        event={event}
                        application={application}
                        isOwnEvent={event.photographer.userId === currentUserId}
                    />
                </Group>

                {isCommentFormOpen && (
                    <AddCommentForm
                        eventId={event.id}
                        eventTitle={event.title}
                        onPosted={() => setPostedHere((count) => count + 1)}
                    />
                )}
            </Stack>
        </Card>
    );
}
