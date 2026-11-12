"use client";

import { Anchor, Badge, Group, Stack, Text } from "@mantine/core";
import { IconCheck, IconUserCheck } from "@tabler/icons-react";
import Link from "next/link";

import type { Application } from "~/_utils/bookings";

import { applyButtonState } from "../bookings/applyButton";
import ApplyModal from "../bookings/ApplyModal";

type ApplyActionProps = {
    event: { id: string; title: string };
    /** The viewer's application; undefined while it is still loading. */
    application: Application | undefined;
    isOwnEvent: boolean;
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
 * withdrawing, or see how their application stands. Whether applying is
 * offered is applyButtonState's decision (what the server would accept);
 * this component adds the wording and the status badges around it.
 */
export default function ApplyAction({ event, application, isOwnEvent, prominent = false }: ApplyActionProps) {
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
    // Apply, apply again, or why not: the one rule shared with the server.
    const control = applyButtonState(application);

    if (control.kind === "apply") {
        const withdrawn = application.canReapply;
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

    // An application on record: say how it stands.
    if (application.hasApplied) {
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
        if (status === "canceled") {
            return <Badge variant="light" color="gray" data-testid="application-status">Booking canceled</Badge>;
        }
        return (
            <Group gap="sm" wrap="nowrap" data-testid="application-status">
                <Badge variant="light" color="teal" leftSection={<IconCheck size={12} aria-hidden />}>Applied</Badge>
                {prominent && bookingsLink("View your application")}
            </Group>
        );
    }

    // No application, and the event takes none: a past event already says
    // "Past event" next to its date.
    if (application.applyBlockedBy === "event_started") return null;
    return <Badge variant="light" color="gray" data-testid="application-status">{control.label}</Badge>;
}
