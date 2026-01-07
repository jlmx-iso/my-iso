'use client';

import { Card, Group, Text, Title, Badge, Image } from '@mantine/core';
import { useHover } from '@mantine/hooks';
import Link from 'next/link';
import type { RouterOutputs } from '~/trpc/react';

type EventSearchCardProps = {
  event: RouterOutputs['search']['searchAll']['events'][number];
};

export default function EventSearchCard({ event }: EventSearchCardProps) {
  const { hovered, ref } = useHover();
  const photographerName = event.photographer.name ||
    `${event.photographer.user.firstName || ''} ${event.photographer.user.lastName || ''}`.trim();

  return (
    <div ref={ref}>
      <Card shadow={hovered ? "xl" : "sm"} p="xl" radius="md" withBorder>
        <Link href={`/app/events/${event.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Group justify="space-between" mb="md" wrap="wrap">
            <Text size="sm" fs="italic" c="dimmed">{event.location}</Text>
            <Group gap="xs">
              <Badge size="lg" variant="transparent">{event.date.toLocaleDateString()}</Badge>
              <Badge size="sm" variant="outline">
                {event.duration} Hour{event.duration > 1 && "s"}
              </Badge>
            </Group>
          </Group>

          <Text size="sm" c="dimmed" mb="xs">
            by {photographerName}
          </Text>

          <Title order={3}>{event.title}</Title>
          {event.description && (
            <Text mt="xs" c="dimmed" size="sm" lineClamp={2}>
              {event.description}
            </Text>
          )}

          {event.image && (
            <Card.Section mt="md">
              <Image src={event.image} alt={event.title} h={200} />
            </Card.Section>
          )}

          <Group justify="space-between" mt="md">
            <Text size="xs" c="dimmed">
              {event._count.comments} comment{event._count.comments !== 1 && 's'}
            </Text>
            <Text size="xs" c="dimmed">
              {event._count.eventLikes} like{event._count.eventLikes !== 1 && 's'}
            </Text>
          </Group>
        </Link>
      </Card>
    </div>
  );
}
