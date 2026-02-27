"use client";

import { ActionIcon, Badge, Box, Card, Divider, Group, Image, Stack, Text, Title } from "@mantine/core";
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
    hideCompose?: boolean;
    variant?: "feed" | "hero";
};

export default function EventCard({ eventId, initialCommentCount = 0, isEventPage, hideCompose, variant = "feed" }: EventCardProps) {
    const [isCommentFormOpen, setIsCommentFormOpen] = useState(isEventPage && !hideCompose);
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

    const isHero = variant === "hero";

    if (isPending) {
        return (
            <Card p={isHero ? "lg" : "md"} radius="md" withBorder>
                <EventCardSkeleton variant={variant} />
            </Card>
        )
    }

    if (isError) {
        return (
            <Card p="lg" radius="md" withBorder>
                <Text c="dimmed" size="sm">Error loading event</Text>
            </Card>
        )
    }

    if (data?.id) {
        // Detail page — flush layout, no card chrome
        if (isEventPage) {
            return (
                <div ref={ref}>
                    <Card p={0} radius="md" style={{ border: "none", background: "transparent" }}>
                        <Stack gap="xs">
                            <Group justify="space-between" align="center">
                                <UserBadge user={data.photographer} />
                                <Timemarker date={data.createdAt} />
                            </Group>

                            <Box>
                                <Title order={2} mb={6}>{data.title}</Title>
                                {data.description && (
                                    <Text c="dimmed" size="sm" maw={680} style={{ lineHeight: 1.6 }}>
                                        {data.description}
                                    </Text>
                                )}
                            </Box>

                            {data.image && (
                                <Box style={{ borderRadius: "var(--mantine-radius-md)", overflow: "hidden" }} mt={4}>
                                    <Image
                                        src={data.image}
                                        alt={data.title}
                                        h={320}
                                        fit="cover"
                                    />
                                </Box>
                            )}

                            <Group gap="xs" wrap="wrap" justify="space-between" align="center">
                                <Group gap="xs" wrap="wrap" align="center">
                                    {data.location && (
                                        <Badge variant="light" color="teal" size="xs">
                                            {data.location}
                                        </Badge>
                                    )}
                                    <Badge variant="light" size="xs">
                                        {data.date.toLocaleDateString()}
                                    </Badge>
                                    <Badge variant="light" color="purple" size="xs">
                                        {data.duration} hour{data.duration > 1 ? "s" : ""}
                                    </Badge>
                                </Group>

                                {!isOwnEvent && (
                                    <ApplyModal
                                        eventId={data.id}
                                        eventTitle={data.title}
                                        hasApplied={applicationStatus?.hasApplied ?? false}
                                    />
                                )}
                            </Group>

                            <Divider mt="sm" />

                            {isCommentFormOpen && !hideCompose && <AddCommentForm eventId={data.id} />}
                        </Stack>
                    </Card>
                </div>
            )
        }

        // Feed / hero card — bordered, hover lift, accent stripe
        return (
            <div ref={ref}>
                <Card
                    shadow={hovered ? "md" : "xs"}
                    p={0}
                    radius="md"
                    withBorder
                    style={{
                        transition: "all 200ms ease",
                        transform: hovered ? "translateY(-2px)" : "none",
                        borderLeft: "3px solid var(--mantine-color-orange-3)",
                    }}
                >
                    {/* Image — full bleed at top when available */}
                    {data.image && (
                        <Card.Section>
                            <Link href={`/app/events/${data.id}`}>
                                <Image
                                    src={data.image}
                                    alt={data.title}
                                    h={isHero ? 280 : 180}
                                    fit="cover"
                                />
                            </Link>
                        </Card.Section>
                    )}

                    <Stack gap="xs" p={isHero ? "lg" : "md"}>
                        <Group justify="space-between" align="center">
                            <UserBadge user={data.photographer} />
                            <Timemarker date={data.createdAt} />
                        </Group>

                        <Link href={`/app/events/${data.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                            <Title order={isHero ? 3 : 4} mb={2}>{data.title}</Title>
                            {data.description && (
                                <Text c="dimmed" size="sm" lineClamp={2}>{data.description}</Text>
                            )}
                        </Link>

                        <Group gap="xs" wrap="wrap" justify="space-between" align="center">
                            <Group gap="xs" wrap="wrap" align="center">
                                {data.location && (
                                    <Badge variant="light" color="teal" size="xs">
                                        {data.location}
                                    </Badge>
                                )}
                                <Badge variant="light" size="xs">
                                    {data.date.toLocaleDateString()}
                                </Badge>
                                <Badge variant="light" color="purple" size="xs">
                                    {data.duration} hour{data.duration > 1 ? "s" : ""}
                                </Badge>
                                <Group gap={4} align="center" ml={4}>
                                    <ActionIcon
                                        size="sm"
                                        variant="subtle"
                                        color="gray"
                                        aria-label="Toggle comments"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            handleCommentButtonClick()
                                        }}
                                    >
                                        <IconMessageCircle size={14} />
                                    </ActionIcon>
                                    {numComments > 0 && (
                                        <Text size="xs" c="dimmed">{numComments}</Text>
                                    )}
                                </Group>
                            </Group>

                            {!isOwnEvent && (
                                <ApplyModal
                                    eventId={data.id}
                                    eventTitle={data.title}
                                    hasApplied={applicationStatus?.hasApplied ?? false}
                                />
                            )}
                        </Group>

                        {isCommentFormOpen && !hideCompose && <AddCommentForm eventId={data.id} />}
                    </Stack>
                </Card>
            </div>
        )
    }

    return null;
}
