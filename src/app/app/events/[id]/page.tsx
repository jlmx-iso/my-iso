import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ErrorReason } from "~/_utils/errorReason";
import { auth } from "~/auth";
import { reasonOf } from "~/server/api/reasonedError";
import { api } from "~/trpc/server";

import EventDetail from "./_components/EventDetail";

type PageProps = { params: Promise<{ id: string }> };

/** The event, or null when it does not exist (or was deleted). */
const findEvent = cache(async (id: string) => {
    try {
        return await (await api()).event.getById({ id });
    } catch (error) {
        // `event.getById` throws for a missing (or deleted) event, with a
        // reason; anything else is a real failure for the error boundary.
        if (reasonOf(error) === ErrorReason.EVENT_NOT_FOUND) return null;
        throw error;
    }
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { id } = await params;
    const event = await findEvent(id);
    return { title: event?.title ?? "Event not found" };
}

export default async function Page({ params }: PageProps) {
    const { id } = await params;
    const [session, event] = await Promise.all([auth(), findEvent(id)]);
    if (!event) notFound();

    return <EventDetail initialEvent={event} currentUserId={session?.user?.id ?? null} />;
}
