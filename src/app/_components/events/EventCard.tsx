"use client";

import { ActionIcon, Badge, Card, Group, Image, Stack, Text, Title } from "@mantine/core";
import { useHover } from '@mantine/hooks';
import { IconMessageCircle } from "@tabler/icons-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";

import ApplyModal from "../bookings/ApplyModal";
import UserBadge from "../UserBadge";
import EventCardSkeleton from "./EventCardSkeleton";
import AddCommentForm from "../AddCommentForm";
import Timemarker from "../Timemarker";

import { api } from "~/trpc/react";

type EventCardProps = {
    eventId: string;
    initialCommentCount?: number;
    isEventPage?: boolean;
};

export default function EventCard({ eventId, initialCommentCount = 0, isEventPage }: EventCardProps) {
    const [isCommentFormOpen, setIsCommentFormOpen] = useState(isEventPage);
    const { hovered, ref } = useHover();
    const session = useSession();
    const { data, isPending, isError } = api.event.getById.useQuery({
        id: eventId
    });

    const currentUserId = session.data?.user?.id;
    const isOwnEvent = data?.photographer?.userId === currentUserId;
    const numComments = data?.commentCount ?? initialCommentCount;

    const { data: applicationStatus } = api.booking.hasApplied.useQuery(
        { eventId },
        { enabled: !!data?.id && !isOwnEvent },
    );

    const handleCommentButtonClick = () => {
        if (!isEventPage) setIsCommentFormOpen((prev) => !prev);
    }

    if (isPending) {
        return (
            <Card p="xl" radius="md" withBorder>
                <EventCardSkeleton />
            </Card>
        )
    }

    if (isError) {
        return (
            <Card p="xl" radius="md" withBorder>
                <Text c="dimmed" size="sm">Error loading event</Text>
            </Card>
        )
    }

    if (data?.id) {
        return (
            <div ref={ref}>
                <Card
                    shadow={hovered ? "md" : "xs"}
                    p="xl"
                    radius="md"
                    withBorder
                    style={{ transition: "box-shadow 150ms ease" }}
                >
                    <Stack gap="sm">
                        <Group justify="space-between" align="center">
                            <UserBadge user={data.photographer} />
                            <Timemarker date={data.createdAt} />
                        </Group>

                        <Link href={`/app/events/${data.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                            <Title order={3} mb={4}>{data.title}</Title>
                            {data.description && (
                                <Text c="dimmed" size="sm" lineClamp={3}>{data.description}</Text>
                            )}
                        </Link>

                        <Group gap="xs" wrap="wrap">
                            {data.location && (
                                <Badge variant="light" color="gray" size="sm">
                                    {data.location}
                                </Badge>
                            )}
                            <Badge variant="light" size="sm">
                                {data.date.toLocaleDateString()}
                            </Badge>
                            <Badge variant="outline" size="sm">
                                {data.duration} hour{data.duration > 1 ? "s" : ""}
                            </Badge>
                        </Group>

                        {data.image && (
                            <Card.Section mt="xs">
                                <Link href={`/app/events/${data.id}`}>
                                    <Image
                                        src={data.image}
                                        alt={data.title}
                                        h={280}
                                        fit="cover"
                                    />
                                </Link>
                            </Card.Section>
                        )}

                        <Group justify="space-between" align="center">
                            <Group>
                                <ActionIcon
                                    size="lg"
                                    variant="subtle"
                                    color="gray"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        handleCommentButtonClick()
                                    }}
                                >
                                    <IconMessageCircle size={20} />
                                </ActionIcon>
                                {numComments > 0 && (
                                    <Text size="sm" c="dimmed">{numComments}</Text>
                                )}
                            </Group>

                            {!isOwnEvent && (
                                <ApplyModal
                                    eventId={data.id}
                                    eventTitle={data.title}
                                    hasApplied={applicationStatus?.hasApplied ?? false}
                                />
                            )}
                        </Group>

                        {isCommentFormOpen && <AddCommentForm eventId={data.id} />}
                    </Stack>
                </Card>
            </div>
        )
    }
}
