'use client';

import { AspectRatio, Badge, Card, Group, Image, Stack, Text, Title } from '@mantine/core';
import { IconCalendar, IconClock, IconHeart, IconMapPin, IconMessageCircle } from '@tabler/icons-react';
import Link from 'next/link';

import { formatDate } from '~/_lib/dayjs';
import UserBadge from '~/app/_components/UserBadge';
import type { RouterOutputs } from '~/trpc/react';

type EventSearchCardProps = {
  event: RouterOutputs['search']['searchAll']['events'][number];
};

export default function EventSearchCard({ event }: EventSearchCardProps) {
  const photographerName = event.photographer.name ||
    `${event.photographer.user.firstName || ''} ${event.photographer.user.lastName || ''}`.trim();
  const href = `/app/events/${event.id}`;

  return (
    <Card
      component="article"
      className="card-interactive"
      shadow="xs"
      p={0}
      radius="md"
      h="100%"
      data-testid="search-event-card"
    >
      {event.image && (
        // The title links to the same page; this is a bigger pointer target only.
        <Link href={href} tabIndex={-1} aria-hidden="true">
          {/* A fixed ratio, so the image is never cropped to a strip. */}
          <AspectRatio ratio={16 / 9}>
            <Image src={event.image} alt="" fit="cover" />
          </AspectRatio>
        </Link>
      )}

      {/* The border and accent stripe are drawn around the text only, so a
          cover image runs edge to edge under the card's rounded corners. */}
      <Stack
        gap="xs"
        p="md"
        style={{
          flex: 1,
          border: '1px solid var(--mantine-color-gray-3)',
          borderLeft: '3px solid var(--mantine-color-orange-3)',
          borderRadius: event.image
            ? '0 0 var(--mantine-radius-md) var(--mantine-radius-md)'
            : 'var(--mantine-radius-md)',
          borderTopWidth: event.image ? 0 : 1,
        }}
      >
        <UserBadge
          user={{
            userId: event.photographer.user.id,
            name: photographerName,
            avatar: event.photographer.user.profilePic,
          }}
        />

        <Title order={3} size="h5" style={{ overflowWrap: 'anywhere' }}>
          <Link href={href}>{event.title}</Link>
        </Title>
        {event.description && (
          <Text c="dimmed" size="sm" lineClamp={2}>{event.description}</Text>
        )}

        <Group gap="xs" wrap="wrap">
          {event.location && (
            <Badge variant="light" color="teal" leftSection={<IconMapPin size={12} aria-hidden />}>
              <span className="sr-only">Location: </span>{event.location}
            </Badge>
          )}
          <Badge variant="light" leftSection={<IconCalendar size={12} aria-hidden />}>
            <span className="sr-only">Date: </span>{formatDate(event.date)}
          </Badge>
          <Badge variant="light" color="purple" leftSection={<IconClock size={12} aria-hidden />}>
            <span className="sr-only">Duration: </span>{event.duration} hour{event.duration === 1 ? '' : 's'}
          </Badge>
        </Group>

        <Group gap="md" mt="auto" pt={4}>
          <Group gap={4} wrap="nowrap">
            <IconMessageCircle size={14} color="var(--mantine-color-dimmed)" aria-hidden />
            <Text size="xs" c="dimmed">
              {event._count.comments}<span className="sr-only"> comments</span>
            </Text>
          </Group>
          <Group gap={4} wrap="nowrap">
            <IconHeart size={14} color="var(--mantine-color-dimmed)" aria-hidden />
            <Text size="xs" c="dimmed">
              {event._count.eventLikes}<span className="sr-only"> likes</span>
            </Text>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}
