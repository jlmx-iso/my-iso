'use client';

import { Badge, Card, Group, Image, Stack, Text, Title } from '@mantine/core';
import { useHover } from '@mantine/hooks';
import { IconHeart, IconMessageCircle } from '@tabler/icons-react';
import Link from 'next/link';
import UserBadge from '~/app/_components/UserBadge';
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
      <Card
        shadow={hovered ? 'md' : 'xs'}
        p={0}
        radius="md"
        withBorder
        style={{
          transition: 'all 200ms ease',
          transform: hovered ? 'translateY(-2px)' : 'none',
          borderLeft: '3px solid var(--mantine-color-orange-3)',
        }}
      >
        <Link href={`/app/events/${event.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          {/* Hero image — full bleed at top */}
          {event.image && (
            <Card.Section>
              <Image src={event.image} alt={event.title} h={160} fit="cover" />
            </Card.Section>
          )}

          <Stack gap="xs" p="md">
            {/* UserBadge + date */}
            <Group justify="space-between" align="center">
              <UserBadge
                user={{
                  userId: event.photographer.user.id,
                  name: photographerName,
                  avatar: event.photographer.user.profilePic,
                }}
              />
              <Text size="xs" c="dimmed">{event.date.toLocaleDateString()}</Text>
            </Group>

            {/* Title + description */}
            <Title order={4}>{event.title}</Title>
            {event.description && (
              <Text c="dimmed" size="sm" lineClamp={2}>{event.description}</Text>
            )}

            {/* Badges + counts */}
            <Group gap="xs" wrap="wrap" justify="space-between" align="center">
              <Group gap="xs" wrap="wrap" align="center">
                {event.location && (
                  <Badge variant="light" color="teal" size="xs">{event.location}</Badge>
                )}
                <Badge variant="light" size="xs">{event.date.toLocaleDateString()}</Badge>
                <Badge variant="light" color="purple" size="xs">
                  {event.duration} hour{event.duration > 1 ? 's' : ''}
                </Badge>
              </Group>

              <Group gap="sm" align="center">
                <Group gap={4} align="center">
                  <IconMessageCircle size={14} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed">{event._count.comments}</Text>
                </Group>
                <Group gap={4} align="center">
                  <IconHeart size={14} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed">{event._count.eventLikes}</Text>
                </Group>
              </Group>
            </Group>
          </Stack>
        </Link>
      </Card>
    </div>
  );
}
