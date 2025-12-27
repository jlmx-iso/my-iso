import { redirect } from 'next/navigation'

import EventCard from "./EventCard";

import { getServerAuthSession } from "~/server/auth";
import { api } from "~/trpc/server";


const EVENTS_LIMIT = 10;

export default async function EventsFeed() {
    const session = await getServerAuthSession();

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
        return <p>No upcoming events</p>;
    }

    return (
        events.map((event) => (
            <EventCard key={event.id} eventId={event.id} />
        ))
    )
}