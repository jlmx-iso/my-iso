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
import DateTile from "./DateTile";
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

/**
 * One event in the feed, read top to bottom in the order people decide:
 * when (the date tile) and what (the title), then the time, place, length
 * and pay, a line of the description, who posted it, and what to do.
 * Renders from the feed row: no request of its own.
 */
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
            data-testid="event-card"
        >
            {event.image && (
                // The title below links to the same page; this link is a
                // bigger pointer target only.
                <Link href={href} tabIndex={-1} aria-hidden="true">
                    <EventCover src={event.image} h={160} />
                </Link>
            )}

            <Stack gap="sm" p="md" style={{ flex: 1 }}>
                <Group gap="md" align="flex-start" wrap="nowrap">
                    <DateTile date={event.date} timeZone={event.timeZone} isPast={isPast} />
                    <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                        <Title order={3} size="h4" lh={1.3} style={{ overflowWrap: "anywhere" }}>
                            <Link href={href}>{event.title}</Link>
                        </Title>
                        <EventMeta
                            date={event.date}
                            timeZone={event.timeZone}
                            duration={event.duration}
                            location={event.location}
                            payCents={event.payCents}
                            timeFormat="time"
                        />
                        {isPast && <Badge variant="light" color="gray" w="fit-content">Past event</Badge>}
                    </Stack>
                </Group>

                {event.description && (
                    <Text c="dimmed" size="sm" lineClamp={2}>{event.description}</Text>
                )}

                <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
                    <UserBadge user={event.photographer} />
                    <Box style={{ flexShrink: 0 }}>
                        <Timemarker date={event.createdAt} prefix="Posted" />
                    </Box>
                </Group>

                <Group
                    gap="xs"
                    justify="space-between"
                    align="center"
                    mt="auto"
                    pt="sm"
                    style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
                >
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
                        {/* No "0": an empty count reads like an error. */}
                        {commentCount === 0 ? "Comment" : `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
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
