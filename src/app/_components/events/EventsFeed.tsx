"use client";

import { Alert, Button, Center, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconAlertCircle, IconCalendarEvent } from '@tabler/icons-react'
import { keepPreviousData } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'

import { EVENTS_PAGE_SIZE, partitionEventsByDate } from '~/_utils/eventFeed'
import EmptyState from "~/app/_components/EmptyState";
import { type RouterOutputs, api } from "~/trpc/react";

import EventCard from "./EventCard";

type FeedEvent = RouterOutputs["event"]["getRecentByLocation"][number];

type EventsFeedProps = {
    /** The member's location(s); the feed shows events there. */
    locations: string[];
    /** First page, fetched on the server. */
    initialEvents: FeedEvent[];
};

function EventGrid({ events, label }: { events: FeedEvent[]; label: string }) {
    return (
        <SimpleGrid
            component="ul"
            cols={{ base: 1, md: 2 }}
            spacing="md"
            m={0}
            p={0}
            aria-label={label}
        >
            {events.map((event) => (
                <li key={event.id} style={{ listStyle: "none", minWidth: 0 }}>
                    <EventCard eventId={event.id} />
                </li>
            ))}
        </SimpleGrid>
    );
}

/**
 * Events near the member, split into upcoming (soonest first) and past.
 * "Load more" raises the limit of the one feed query (the procedure pages by
 * `limit`/`startAt`), so creating an event only has to invalidate that query.
 */
export default function EventsFeed({ locations, initialEvents }: EventsFeedProps) {
    const [limit, setLimit] = useState(EVENTS_PAGE_SIZE);
    const { data: events = [], isFetching, isError, refetch } = api.event.getRecentByLocation.useQuery(
        { limit, locations, startAt: 0 },
        {
            initialData: limit === EVENTS_PAGE_SIZE ? initialEvents : undefined,
            placeholderData: keepPreviousData,
        },
    );
    // A full page means there may be more.
    const hasMore = events.length >= limit;
    // Evaluated per render on purpose: "upcoming" is relative to now.
    const { upcoming, past } = partitionEventsByDate(events);
    const place = locations[0]?.split(",")[0]?.trim();

    if (isError && events.length === 0) {
        return (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="We couldn't load events">
                <Button variant="default" size="xs" mt="xs" onClick={() => void refetch()}>
                    Try again
                </Button>
            </Alert>
        );
    }

    if (events.length === 0) {
        return (
            <EmptyState
                icon={IconCalendarEvent}
                title={place ? `No events in ${place} yet` : "No events yet"}
                description="Post the first one to find a second shooter, or search for events in other cities."
                action={
                    <Button component={Link} href="/app/search" variant="default">
                        Search events
                    </Button>
                }
            />
        );
    }

    return (
        <Stack gap="xl">
            <Stack gap="md" component="section" aria-labelledby="upcoming-events-heading">
                <Title order={2} size="h4" id="upcoming-events-heading">
                    Upcoming{place ? ` in ${place}` : ""}
                </Title>
                {upcoming.length > 0 ? (
                    <EventGrid events={upcoming} label="Upcoming events" />
                ) : (
                    <Text c="dimmed" size="sm">
                        Nothing coming up{place ? ` in ${place}` : ""} right now. Post an event to find a second shooter.
                    </Text>
                )}
            </Stack>

            {past.length > 0 && (
                <Stack gap="md" component="section" aria-labelledby="past-events-heading">
                    <Title order={2} size="h4" id="past-events-heading">
                        Past events
                    </Title>
                    <EventGrid events={past} label="Past events" />
                </Stack>
            )}

            {hasMore && (
                <Center>
                    <Button
                        variant="default"
                        onClick={() => setLimit((current) => current + EVENTS_PAGE_SIZE)}
                        loading={isFetching}
                    >
                        Load more events
                    </Button>
                </Center>
            )}
        </Stack>
    )
}
