import { Stack } from "@mantine/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { EVENTS_PAGE_SIZE } from "~/_utils/eventFeed";
import CreateEventButton from "~/app/_components/events/CreateEventButton";
import EventsFeed from "~/app/_components/events/EventsFeed";
import PageHeader from "~/app/_components/PageHeader";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Events" };

export default async function Page() {
    const session = await auth();
    if (!session?.user) redirect("/login?callbackUrl=/app/events");

    const caller = await api();
    const photographer = await caller.photographer.getByUserId({ userId: session.user.id });
    const locations = photographer?.location ? [photographer.location] : [];
    const initialUpcoming = await caller.event.getFeedPage({
        limit: EVENTS_PAGE_SIZE,
        locations,
        when: "upcoming",
    });

    return (
        <Stack gap="lg">
            <PageHeader
                title="Events"
                description="Events near you that need a second shooter. Post one when you need help."
                action={<Suspense><CreateEventButton /></Suspense>}
            />
            <EventsFeed currentUserId={session.user.id} locations={locations} initialUpcoming={initialUpcoming} />
        </Stack>
    );
}
