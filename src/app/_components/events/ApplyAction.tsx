"use client";

import { Anchor, Badge, Group, Stack, Text } from "@mantine/core";
import { IconCheck, IconUserCheck } from "@tabler/icons-react";
import Link from "next/link";

import { type Application, canApply } from "~/_utils/bookings";

import ApplyModal from "../bookings/ApplyModal";

type ApplyActionProps = {
    event: { date: Date | string; id: string; isFulfilled?: boolean; title: string };
    /** The viewer's application; undefined while it is still loading. */
    application: Application | undefined;
    isOwnEvent: boolean;
    now: Date;
    /** Detail page: the button is the page's primary action. */
    prominent?: boolean;
};

const bookingsLink = (label: string, tab?: "received") => (
    <Anchor component={Link} href={tab ? `/app/bookings?tab=${tab}` : "/app/bookings"} size="sm" fw={600} underline="always">
        {label}
    </Anchor>
);

/**
 * What the viewer can do about an event: apply, apply again after
 * withdrawing, or see how their application stands. Nothing is offered that
 * the server would refuse (own event, past event, filled event).
 */
export default function ApplyAction({ event, application, isOwnEvent, now, prominent = false }: ApplyActionProps) {
    const isPast = new Date(event.date).getTime() < now.getTime();

    if (isOwnEvent) {
        return (
            <Group gap="sm" wrap="nowrap">
                <Badge variant="light" color="gray">Your event</Badge>
                {prominent && bookingsLink("View applications", "received")}
            </Group>
        );
    }
    // Still loading: say nothing rather than offer a button that may be wrong.
    if (application === undefined) return null;
    const { status } = application;

    if (status === "applied") {
        return (
            <Group gap="sm" wrap="nowrap" data-testid="application-status">
                <Badge variant="light" color="teal" leftSection={<IconCheck size={12} aria-hidden />}>Applied</Badge>
                {prominent && bookingsLink("View your application")}
            </Group>
        );
    }
    if (status === "accepted" || status === "completed") {
        return (
            <Group gap="sm" wrap="nowrap" data-testid="application-status">
                <Badge variant="filled" color="teal" leftSection={<IconUserCheck size={12} aria-hidden />}>
                    {status === "accepted" ? "You're booked" : "Completed"}
                </Badge>
                {prominent && bookingsLink("View booking")}
            </Group>
        );
    }
    if (status === "declined") {
        return <Badge variant="light" color="gray" data-testid="application-status">Not selected</Badge>;
    }
    if (status === "canceled" && !application.canReapply) {
        return <Badge variant="light" color="gray" data-testid="application-status">Booking canceled</Badge>;
    }
    if (isPast) return null;

    if (!canApply({ application, eventDate: event.date, isFilled: event.isFulfilled, now })) {
        return <Badge variant="light" color="gray" data-testid="application-status">Filled</Badge>;
    }

    const withdrawn = status === "canceled";
    const button = (
        <ApplyModal
            eventId={event.id}
            eventTitle={event.title}
            label={withdrawn ? "Apply again" : prominent ? "Apply to this event" : "Apply"}
            prominent={prominent}
        />
    );
    if (!withdrawn || !prominent) return button;
    return (
        <Stack gap={6} w={{ base: "100%", xs: "auto" }}>
            {button}
            <Text size="xs" c="dimmed" data-testid="application-status">
                You withdrew your earlier application.
            </Text>
        </Stack>
    );
}
