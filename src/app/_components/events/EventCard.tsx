"use client";

import { ActionIcon, Badge, Card, Group, Image, Text, Title } from "@mantine/core";
import { useHover } from '@mantine/hooks';
import Link from "next/link";
import { api } from "~/trpc/react";
import UserBadge from "../UserBadge";
import EventCardSkeleton from "./EventCardSkeleton";
import { IconMessageCircle } from "@tabler/icons-react";
import { useState } from "react";
import AddCommentForm from "../AddCommentForm";
import Timemarker from "../Timemarker";

type EventCardProps = {
    eventId: string;
    initialCommentCount?: number;
    isEventPage?: boolean;
};

export default function EventCard({ eventId, initialCommentCount = 0, isEventPage }: EventCardProps) {
    const [isCommentFormOpen, setIsCommentFormOpen] = useState(isEventPage);
    const [numComments, setNumComments] = useState(initialCommentCount);
    const { hovered, ref } = useHover();
    const { data, isLoading, isError } = api.event.getById.useQuery({
        id: eventId
    }, {
        onSuccess: (data) => {
            setNumComments(data.commentCount);
        }
    });

    const handleCommentButtonClick = () => {
        if (!isEventPage) setIsCommentFormOpen((prev) => !prev);
    }

    if (isLoading) {
        return (
            <Card>
                <EventCardSkeleton />
            </Card>
        )
    }

    if (isError) {
        return (
            <Card>
                <p>Error loading event</p>
            </Card>
        )
    }

    if (data?.id) {
        return (
            <div ref={ref}>
                <Card shadow={hovered ? "xl" : "sm"} p="xl" pb="sm" radius="md" withBorder >
                    <Group p="sm" justify="end" gap="lg" m="-2em">
                        <Text size="sm" fs="italic">{data.location}</Text>
                        <Badge size="lg" variant="transparent">{data.date.toLocaleDateString()}</Badge>
                        <Badge size="sm" variant="outline">{data.duration} Hour{data.duration > 1 && "s"}</Badge>
                    </Group>
                    <UserBadge user={data.photographer} />
                    <Link href={`/app/events/${data.id}`}>
                        <Title order={3}>{data.title}</Title>
                        <Text mt="xs" c="dimmed" size="sm">{data.description}</Text>
                    </Link>
                    {data.image && (
                        <Card.Section m="md">
                            <Card component={Link} href={`/app/events/${data.id}`} radius="md" shadow="none" withBorder m="0" mah={320} p={0}>
                                <Image src={data.image} alt={data.title} h={320} style={{ position: "relative" }} />
                            </Card>
                        </Card.Section>
                    )}
                    <Group justify="space-between">
                        <ActionIcon
                            size="xl"
                            variant="subtle"
                            onClick={(e) => {
                                e.preventDefault();
                                handleCommentButtonClick()
                            }}
                            style={{ zIndex: 9999 }}
                        >
                            <IconMessageCircle size="2em" />{numComments > 0 && ` ${numComments}`}
                        </ActionIcon>
                        <Timemarker date={data.createdAt} />
                    </Group>
                    {isCommentFormOpen && <AddCommentForm eventId={data.id} />}
                </Card>
            </div>
        )
    }
}