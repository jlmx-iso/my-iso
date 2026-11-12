'use client';

import { AspectRatio, Card, Group, Image, Stack, Text, Title } from '@mantine/core';
import { IconHeart, IconMessageCircle } from '@tabler/icons-react';
import Link from 'next/link';

import { fullName } from '~/_utils/names';
import EventMeta from "~/app/_components/events/EventMeta";
import UserBadge from '~/app/_components/UserBadge';
import type { RouterOutputs } from '~/trpc/react';

type EventSearchCardProps = {
  event: RouterOutputs['search']['searchAll']['events'][number];
};

export default function EventSearchCard({ event }: EventSearchCardProps) {
  const photographerName = event.photographer.name || fullName(event.photographer.user);
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
            <Image src={event.image} alt="" fit="cover" data-replay-block />
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
            isPro: event.photographer.isPro,
          }}
        />

        <Title order={3} size="h5" style={{ overflowWrap: 'anywhere' }}>
          <Link href={href}>{event.title}</Link>
        </Title>
        {event.description && (
          <Text c="dimmed" size="sm" lineClamp={2}>{event.description}</Text>
        )}

        <EventMeta
          date={event.date}
          timeZone={event.timeZone}
          duration={event.duration}
          location={event.location}
          payCents={event.payCents}
        />

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
