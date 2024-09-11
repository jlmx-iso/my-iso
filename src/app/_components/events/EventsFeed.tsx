import { api } from "~/trpc/server";
import EventCard from "./EventCard";
import { getServerAuthSession } from "~/server/auth";
import { redirect } from 'next/navigation'

const EVENTS_LIMIT = 10;

export default async function EventsFeed() {
    const session = await getServerAuthSession();

    if (!session?.user) {
        return redirect('/api/auth/signin');
    }

    const locations = await api.photographer.getByUserId.query({
        userId: session.user.id,
    }).then((photographer) => {
        if (!photographer) {
            return [];
        }
        return [photographer.location];
    });
    const events = await api.event.getRecentByLocation.query({
        locations,
        limit: EVENTS_LIMIT,
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