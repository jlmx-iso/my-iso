"use client";

import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import Link from "next/link";

import { Avatar } from "~/app/_components/Avatar";
import { type EditableEvent } from "~/app/_components/events/CreateEventForm";
import EditEventButton from "~/app/_components/events/EditEventButton";
import { ProBadge } from "~/app/_components/ProBadge";
import Timemarker from "~/app/_components/Timemarker";

type EventOwnerCardProps = {
    event: EditableEvent & {
        createdAt: Date;
        photographer: { userId: string; name: string; avatar: string | null; isPro: boolean };
    };
    /** The viewer posted this event: offer to edit it instead of to message. */
    isOwner: boolean;
    /** The "Message" control (rendered on the server); not shown to the owner. */
    messageAction?: React.ReactNode;
};

/**
 * Who posted the event, with their Pro badge, and the two things a second
 * shooter wants to do about them: look at their work, or ask a question.
 * The owner sees "Edit event" instead of a way to message themselves.
 */
export default function EventOwnerCard({ event, isOwner, messageAction }: EventOwnerCardProps) {
    const { photographer } = event;
    return (
        <Paper withBorder radius="md" p="md" component="section" aria-labelledby="event-owner-heading" data-testid="event-owner-card">
            <Group justify="space-between" align="center" gap="md" wrap="wrap">
                <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                    <Avatar src={photographer.avatar} name={photographer.name} alt="" size="lg" />
                    <Stack gap={2} style={{ minWidth: 0 }}>
                        <Text size="xs" c="dimmed" id="event-owner-heading">
                            {isOwner ? "You posted this event" : "Posted by"}
                        </Text>
                        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                            <Text fw={600} truncate>{photographer.name}</Text>
                            {photographer.isPro && <ProBadge />}
                        </Group>
                        <Timemarker date={event.createdAt} prefix="Posted" />
                    </Stack>
                </Group>
                <Group gap="xs" wrap="wrap">
                    <Button
                        component={Link}
                        href={`/app/photographer/${photographer.userId}`}
                        variant="default"
                        size="sm"
                        leftSection={<IconUser size={16} aria-hidden />}
                    >
                        {isOwner ? "Your profile" : "View profile"}
                    </Button>
                    {isOwner ? (
                        <EditEventButton
                            event={{
                                date: event.date,
                                description: event.description,
                                duration: event.duration,
                                id: event.id,
                                location: event.location,
                                payCents: event.payCents,
                                title: event.title,
                            }}
                        />
                    ) : (
                        messageAction
                    )}
                </Group>
            </Group>
        </Paper>
    );
}
