'use client';

import { Card, Group, Image, Stack, Text, Title } from '@mantine/core';
import { IconChevronRight, IconMapPin } from '@tabler/icons-react';
import Link from 'next/link';

import { Avatar } from '~/app/_components/Avatar';
import type { RouterOutputs } from '~/trpc/react';

type PhotographerCardProps = {
  photographer: RouterOutputs['search']['searchAll']['photographers'][number];
};

export default function PhotographerCard({ photographer }: PhotographerCardProps) {
  const displayName =
    photographer.name ||
    `${photographer.user.firstName || ''} ${photographer.user.lastName || ''}`.trim() ||
    'ISO member';
  const profileHref = `/app/photographer/${photographer.user.id}`;
  const thumbnails = photographer.portfolioImages ?? [];

  return (
    <Card
      component="article"
      className="card-interactive"
      shadow="xs"
      p="md"
      radius="md"
      withBorder
      h="100%"
      pos="relative"
      style={{ borderLeft: '3px solid var(--mantine-color-orange-3)' }}
      data-testid="search-photographer-card"
    >
      <Stack gap="sm">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <Avatar src={photographer.user.profilePic} name={displayName} alt="" size={48} />
          {/* The name wraps instead of truncating: it is what people search for. */}
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Title order={3} size="h5" style={{ overflowWrap: 'anywhere' }}>
              {/* The ::after stretches the link over the whole card. */}
              <Link href={profileHref} className="stretched-link">
                {displayName}
              </Link>
            </Title>
            {photographer.companyName && (
              <Text size="sm" c="dimmed" fw={500}>
                {photographer.companyName}
              </Text>
            )}
            {photographer.location && (
              <Group gap={4} wrap="nowrap">
                <IconMapPin size={14} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} aria-hidden />
                <Text size="sm" c="dimmed">{photographer.location}</Text>
              </Group>
            )}
          </Stack>
          <IconChevronRight size={18} color="var(--mantine-color-gray-6)" style={{ flexShrink: 0 }} aria-hidden />
        </Group>

        {photographer.bio && (
          <Text size="sm" c="dimmed" lineClamp={2}>
            {photographer.bio}
          </Text>
        )}

        {thumbnails.length > 0 && (
          <Group gap="xs" wrap="nowrap" style={{ overflow: 'hidden' }} aria-hidden>
            {thumbnails.map((img) => (
              <Image
                key={img.id}
                src={img.image}
                alt=""
                w={72}
                h={56}
                radius="sm"
                fit="cover"
                style={{ flexShrink: 0 }}
              />
            ))}
          </Group>
        )}
      </Stack>
    </Card>
  );
}
