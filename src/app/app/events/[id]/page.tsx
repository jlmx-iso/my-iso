import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { api } from "~/trpc/server";

import EventDetail from "./_components/EventDetail";

type PageProps = { params: Promise<{ id: string }> };

/** The event, or null when it does not exist (or was deleted). */
async function findEvent(id: string) {
    try {
        return await (await api()).event.getById({ id });
    } catch (error) {
        // `event.getById` throws for a missing event rather than returning null.
        if (error instanceof Error && /not found/i.test(error.message)) return null;
        throw error;
    }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { id } = await params;
    const event = await findEvent(id);
    return { title: event?.title ?? "Event not found" };
}

export default async function Page({ params }: PageProps) {
    const { id } = await params;
    const event = await findEvent(id);
    if (!event) notFound();

    return <EventDetail eventId={id} eventTitle={event.title} />;
}
