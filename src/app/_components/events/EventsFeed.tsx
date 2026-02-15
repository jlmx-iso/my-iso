import { Stack } from '@mantine/core'
import { IconCalendarEvent } from '@tabler/icons-react'
import { redirect } from 'next/navigation'

import EmptyState from "~/app/_components/EmptyState";
import EventCard from "./EventCard";

import { auth } from "~/auth";
import { api } from "~/trpc/server";


const EVENTS_LIMIT = 10;

export default async function EventsFeed() {
    const session = await auth();

    if (!session?.user) {
        return redirect('/api/auth/signin');
    }

    const locations = await (await api()).photographer.getByUserId({
        userId: session.user.id,
    }).then((photographer) => {
        if (!photographer) {
            return [];
        }
        return [photographer.location];
    });
    const events = await (await api()).event.getRecentByLocation({
        limit: EVENTS_LIMIT,
        locations,
        startAt: 0
    });

    if (events.length === 0) {
        return (
            <EmptyState
                icon={IconCalendarEvent}
                title="No upcoming events"
                description="Events in your area will show up here. Create one to get started."
            />
        );
    }

    return (
        <Stack gap="md">
            {events.map((event: any) => (
                <EventCard key={event.id} eventId={event.id} />
            ))}
        </Stack>
    )
}
