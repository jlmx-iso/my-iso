"use client";

import { Alert, Button, Group, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core'
import { IconAlertCircle, IconCalendarEvent, IconHistory, IconPlus } from '@tabler/icons-react'
import Link from 'next/link'
import { useState } from 'react'

import { type Application, NOT_APPLIED, applicationsByEvent, applyBlockerOf } from '~/_utils/bookings'
import { EVENTS_PAGE_SIZE, type FeedWhen, feedView, isFeedWhen } from '~/_utils/eventFeed'
import { trpcErrorCode } from '~/_utils/userError'
import EmptyState from "~/app/_components/EmptyState";
import { useFocusNewItems } from "~/app/_hooks/useFocusNewItems";
import { useNow } from "~/app/_hooks/useNow";
import { type RouterOutputs, api } from "~/trpc/react";

import EventCard, { type FeedEvent } from "./EventCard";
import EventCardSkeleton from "./EventCardSkeleton";

type FeedPage = RouterOutputs["event"]["getFeedPage"];

type EventsFeedProps = {
    currentUserId: string;
    /** The member's location(s); the feed shows events there. */
    locations: string[];
    /** First page of upcoming events, fetched on the server. */
    initialUpcoming: FeedPage;
};

/** One request tells every card in the feed how the viewer's application stands. */
const APPLICATIONS_LIMIT = 100;
/** The server just rendered this data: no need to ask again on mount. */
const FRESH_FOR_MS = 30_000;

/**
 * The viewer's application to one event. Known from the feed's single
 * applications request; only someone with more applications than that
 * request returns asks per event.
 */
function FeedCard({
    event,
    applications,
    currentUserId,
    now,
}: {
    event: FeedEvent;
    now: Date;
    /** The applications request's answer; undefined while it loads. */
    applications: { byEvent: Map<string, Application>; isComplete: boolean } | undefined;
    currentUserId: string;
}) {
    const isOwnEvent = event.photographer.userId === currentUserId;
    const known = applications?.byEvent.get(event.id) ?? (applications?.isComplete ? NOT_APPLIED : undefined);
    const needsLookup = !!applications && known === undefined && !isOwnEvent;
    const lookup = api.booking.hasApplied.useQuery({ eventId: event.id }, { enabled: needsLookup });
    // From the list: whether the event still takes applications is read off
    // the row. From the lookup: the server says (`applyBlockedBy`).
    const application: Application | undefined = known
        ? { ...known, applyBlockedBy: applyBlockerOf(event, now) }
        : lookup.data;

    return <EventCard event={event} application={application} currentUserId={currentUserId} now={now} />;
}

function FeedList({
    when,
    locations,
    initialPage,
    place,
    currentUserId,
}: {
    when: FeedWhen;
    locations: string[];
    initialPage?: FeedPage;
    place: string | undefined;
    currentUserId: string;
}) {
    const utils = api.useUtils();
    const feed = api.event.getFeedPage.useInfiniteQuery(
        { limit: EVENTS_PAGE_SIZE, locations, when },
        {
            getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
            ...(initialPage
                ? { initialData: { pageParams: [undefined], pages: [initialPage] }, staleTime: FRESH_FOR_MS }
                : {}),
        },
    );
    const applications = api.booking.getMyApplications.useQuery({ limit: APPLICATIONS_LIMIT });
    const myApplications = applications.data
        ? {
            byEvent: applicationsByEvent(applications.data),
            // Fewer than the limit came back: the list is all of them.
            isComplete: applications.data.length < APPLICATIONS_LIMIT,
        }
        // The one request failed: each card asks for itself instead.
        : applications.isError
            ? { byEvent: new Map<string, Application>(), isComplete: false }
            : undefined;

    const now = useNow();
    const { events, hasMore, note } = feedView(feed.data?.pages);
    const { expectMore, listRef } = useFocusNewItems(events.length);
    const label = when === "upcoming" ? "Upcoming events" : "Past events";

    const loadMore = async () => {
        expectMore();
        const result = await feed.fetchNextPage();
        // The cursor no longer names an event (it was removed for good):
        // start the list again from its first page.
        if (result.isError && trpcErrorCode(result.error) === "BAD_REQUEST") {
            await utils.event.getFeedPage.reset({ limit: EVENTS_PAGE_SIZE, locations, when });
        }
    };

    if (feed.isPending) {
        return (
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" aria-busy="true" aria-label={`Loading ${label.toLowerCase()}`}>
                {[0, 1, 2, 3].map((index) => (
                    <EventCardSkeleton key={index} />
                ))}
            </SimpleGrid>
        );
    }

    if (feed.isError && events.length === 0) {
        return (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="We couldn't load events">
                <Button variant="default" size="xs" mt="xs" onClick={() => void feed.refetch()}>
                    Try again
                </Button>
            </Alert>
        );
    }

    if (events.length === 0) {
        return when === "upcoming" ? (
            <EmptyState
                icon={IconCalendarEvent}
                title={place ? `No upcoming events in ${place}` : "No upcoming events"}
                description={
                    place
                        ? `Events posted in ${place} appear here. Post one to find a second shooter, or search other cities.`
                        : "Add your city to your profile to see events near you, or search events anywhere."
                }
                action={
                    <Group gap="sm" justify="center">
                        {/* Opens the page header's "Create event" dialog. */}
                        <Button component={Link} href="/app/events?create=1" scroll={false} leftSection={<IconPlus size={16} aria-hidden />}>
                            Post an event
                        </Button>
                        <Button component={Link} href="/app/search" variant="default">
                            Search events
                        </Button>
                    </Group>
                }
            />
        ) : (
            <EmptyState
                icon={IconHistory}
                title={place ? `No past events in ${place}` : "No past events"}
                description="Events move here once they have started. Nothing has happened here yet."
            />
        );
    }

    return (
        <Stack gap="lg">
            <SimpleGrid
                ref={listRef}
                component="ul"
                cols={{ base: 1, md: 2 }}
                spacing="md"
                m={0}
                p={0}
                aria-label={label}
            >
                {events.map((event) => (
                    <li key={event.id} style={{ listStyle: "none", minWidth: 0 }}>
                        <FeedCard event={event} applications={myApplications} currentUserId={currentUserId} now={now} />
                    </li>
                ))}
            </SimpleGrid>

            {hasMore && (
                <Stack gap={6} align="center">
                    <Text size="sm" c="dimmed" role="status" data-testid="events-partial">
                        {note}
                    </Text>
                    <Button
                        variant="default"
                        onClick={() => void loadMore()}
                        loading={feed.isFetchingNextPage}
                        data-testid="events-load-more"
                    >
                        Load more events
                    </Button>
                    {feed.isFetchNextPageError && (
                        <Text size="sm" c="red" role="alert">
                            We couldn&apos;t load more events. Please try again.
                        </Text>
                    )}
                </Stack>
            )}
        </Stack>
    );
}

/**
 * Events near the member: what is coming up, soonest first, and on a second
 * tab what has already happened. Each list loads a page at a time for as
 * long as the server says there is more.
 */
export default function EventsFeed({ currentUserId, locations, initialUpcoming }: EventsFeedProps) {
    const [when, setWhen] = useState<FeedWhen>("upcoming");
    const place = locations[0]?.split(",")[0]?.trim();

    return (
        <Tabs value={when} onChange={(value) => isFeedWhen(value) && setWhen(value)} keepMounted={false}>
            <Tabs.List mb="md">
                <Tabs.Tab value="upcoming" leftSection={<IconCalendarEvent size={16} aria-hidden />}>Upcoming</Tabs.Tab>
                <Tabs.Tab value="past" leftSection={<IconHistory size={16} aria-hidden />}>Past</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="upcoming">
                <Stack gap="md">
                    <Title order={2} size="h4">
                        Upcoming{place ? ` in ${place}` : ""}
                    </Title>
                    <FeedList
                        when="upcoming"
                        locations={locations}
                        initialPage={initialUpcoming}
                        place={place}
                        currentUserId={currentUserId}
                    />
                </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="past">
                <Stack gap="md">
                    <Title order={2} size="h4">
                        Past events{place ? ` in ${place}` : ""}
                    </Title>
                    <FeedList when="past" locations={locations} place={place} currentUserId={currentUserId} />
                </Stack>
            </Tabs.Panel>
        </Tabs>
    )
}
