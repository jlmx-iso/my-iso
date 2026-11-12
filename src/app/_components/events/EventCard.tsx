"use client";

import { Badge, Box, Button, Card, Group, Image, Stack, Text, Title } from "@mantine/core";
import { IconCalendar, IconClock, IconMapPin, IconMessageCircle } from "@tabler/icons-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";

import dayjs, { formatLocalDate } from '~/_lib/dayjs';
import { api } from "~/trpc/react";

import AddCommentForm from "../AddCommentForm";
import ApplyModal from "../bookings/ApplyModal";
import Timemarker from "../Timemarker";
import UserBadge from "../UserBadge";
import EventCardSkeleton from "./EventCardSkeleton";

type EventCardProps = {
    eventId: string;
    /** Detail page: the title is the page's h1 and the layout is flush. */
    isEventPage?: boolean;
};

function formatDuration(hours: number) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Location, date and duration of an event, with text alternatives for the icons. */
function EventMeta({ date, duration, location }: { date: Date | string; duration: number; location: string | null }) {
    return (
        <Group gap="xs" wrap="wrap">
            {location && (
                <Badge variant="light" color="teal" leftSection={<IconMapPin size={12} aria-hidden />}>
                    <span className="sr-only">Location: </span>{location}
                </Badge>
            )}
            <Badge variant="light" leftSection={<IconCalendar size={12} aria-hidden />}>
                <span className="sr-only">Date: </span>{formatLocalDate(date)}
            </Badge>
            <Badge variant="light" color="purple" leftSection={<IconClock size={12} aria-hidden />}>
                <span className="sr-only">Duration: </span>{formatDuration(duration)}
            </Badge>
        </Group>
    );
}

export default function EventCard({ eventId, isEventPage }: EventCardProps) {
    const [isCommentFormOpen, setIsCommentFormOpen] = useState(false);
    const session = useSession();
    const { data, isPending, isError, refetch } = api.event.getById.useQuery({
        id: eventId
    });

    const currentUserId = session.data?.user?.id;
    const isOwnEvent = data?.photographer?.userId === currentUserId;

    const { data: applicationStatus } = api.booking.hasApplied.useQuery(
        { eventId },
        { enabled: !!data?.id && !isOwnEvent },
    );

    if (isPending) {
        return (
            <Card p="md" radius="md" withBorder h="100%" aria-busy="true">
                <EventCardSkeleton />
            </Card>
        )
    }

    if (isError || !data?.id) {
        return (
            <Card p="lg" radius="md" withBorder h="100%">
                <Stack gap="xs" align="flex-start">
                    <Text size="sm">This event couldn&apos;t be loaded.</Text>
                    <Button variant="default" size="xs" onClick={() => void refetch()}>Try again</Button>
                </Stack>
            </Card>
        )
    }

    const isPast = dayjs(data.date).isBefore(dayjs());
    const apply = !isOwnEvent && !isPast && (
        <ApplyModal
            eventId={data.id}
            eventTitle={data.title}
            hasApplied={applicationStatus?.hasApplied ?? false}
        />
    );
    const href = `/app/events/${data.id}`;

    // Detail page — flush layout, no card chrome
    if (isEventPage) {
        return (
            <Stack gap="sm" component="article">
                <Group justify="space-between" align="center" wrap="nowrap">
                    <UserBadge user={data.photographer} />
                    <Timemarker date={data.createdAt} />
                </Group>

                <Box>
                    <Title order={1} size="h2" mb={6} style={{ overflowWrap: "anywhere" }}>{data.title}</Title>
                    {data.description && (
                        <Text maw={680} style={{ lineHeight: 1.6, whiteSpace: "pre-line" }}>
                            {data.description}
                        </Text>
                    )}
                </Box>

                {data.image && (
                    <Image
                        src={data.image}
                        alt=""
                        mah={420}
                        fit="cover"
                        radius="md"
                    />
                )}

                <Group gap="xs" wrap="wrap" justify="space-between" align="center">
                    <Group gap="xs">
                        <EventMeta date={data.date} duration={data.duration} location={data.location} />
                        {isPast && <Badge variant="light" color="gray">Past event</Badge>}
                    </Group>
                    {apply}
                </Group>
            </Stack>
        )
    }

    // Feed card
    return (
        <Card
            component="article"
            className="card-interactive"
            shadow="xs"
            p={0}
            radius="md"
            withBorder
            h="100%"
            style={{ borderLeft: "3px solid var(--mantine-color-orange-3)" }}
            data-testid="event-card"
        >
            {data.image && (
                // The title below links to the same page; this link is a
                // bigger pointer target only.
                <Link href={href} tabIndex={-1} aria-hidden="true">
                    <Image src={data.image} alt="" h={180} fit="cover" />
                </Link>
            )}

            <Stack gap="xs" p="md" style={{ flex: 1 }}>
                <Group justify="space-between" align="center" wrap="nowrap">
                    <UserBadge user={data.photographer} />
                    <Timemarker date={data.createdAt} />
                </Group>

                <Box>
                    <Title order={3} size="h4" mb={2} style={{ overflowWrap: "anywhere" }}>
                        <Link href={href}>{data.title}</Link>
                    </Title>
                    {data.description && (
                        <Text c="dimmed" size="sm" lineClamp={2}>{data.description}</Text>
                    )}
                </Box>

                <EventMeta date={data.date} duration={data.duration} location={data.location} />

                <Group gap="xs" justify="space-between" align="center" mt="auto" pt={4}>
                    <Button
                        variant="subtle"
                        color="gray"
                        size="compact-sm"
                        leftSection={<IconMessageCircle size={16} />}
                        aria-expanded={isCommentFormOpen}
                        aria-label={`Comment on ${data.title}, ${data.commentCount} ${data.commentCount === 1 ? "comment" : "comments"}`}
                        onClick={() => setIsCommentFormOpen((open) => !open)}
                    >
                        {data.commentCount}
                    </Button>
                    {apply}
                </Group>

                {isCommentFormOpen && <AddCommentForm eventId={data.id} eventTitle={data.title} />}
            </Stack>
        </Card>
    )
}
