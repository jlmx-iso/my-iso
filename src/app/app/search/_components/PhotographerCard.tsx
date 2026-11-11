'use client';

import { Button, Card, Group, Image, Stack, Text, Title } from '@mantine/core';
import { useHover } from '@mantine/hooks';
import { IconMapPin } from '@tabler/icons-react';
import Link from 'next/link';
import { Avatar } from '~/app/_components/Avatar';
import type { RouterOutputs } from '~/trpc/react';

type PhotographerCardProps = {
  photographer: RouterOutputs['search']['searchAll']['photographers'][number];
};

export default function PhotographerCard({ photographer }: PhotographerCardProps) {
  const { hovered, ref } = useHover();
  const displayName = `${photographer.user.firstName || ''} ${photographer.user.lastName || ''}`.trim() || photographer.name;
  const profileHref = `/app/photographer/${photographer.user.id}`;
  const thumbnails = photographer.portfolioImages ?? [];

  return (
    <div ref={ref}>
      <Card
        shadow={hovered ? 'md' : 'xs'}
        p="md"
        radius="md"
        withBorder
        style={{
          transition: 'all 200ms ease',
          transform: hovered ? 'translateY(-2px)' : 'none',
          borderLeft: '3px solid var(--mantine-color-orange-3)',
        }}
      >
        <Stack gap="sm">
          {/* Header row: avatar + info + button */}
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <Avatar
                src={photographer.user.profilePic}
                alt={displayName}
                name={displayName}
                size={48}
              />
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Title order={5} lineClamp={1}>{photographer.name}</Title>
                {photographer.companyName && (
                  <Text size="xs" c="dimmed" fw={500} lineClamp={1}>
                    {photographer.companyName}
                  </Text>
                )}
                {photographer.location && (
                  <Group gap={4} wrap="nowrap">
                    <IconMapPin size={12} style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
                    <Text size="xs" c="dimmed" lineClamp={1}>{photographer.location}</Text>
                  </Group>
                )}
              </Stack>
            </Group>

            <Button
              component={Link}
              href={profileHref}
              variant="light"
              size="compact-xs"
              style={{ flexShrink: 0 }}
            >
              View Profile
            </Button>
          </Group>

          {/* Bio */}
          {photographer.bio && (
            <Text size="sm" c="dimmed" lineClamp={2}>
              {photographer.bio}
            </Text>
          )}

          {/* Portfolio thumbnails */}
          {thumbnails.length > 0 && (
            <Group gap="xs">
              {thumbnails.map((img) => (
                <Link key={img.id} href={profileHref}>
                  <Image
                    src={img.image}
                    alt={img.title}
                    w={72}
                    h={56}
                    radius="sm"
                    fit="cover"
                  />
                </Link>
              ))}
            </Group>
          )}
        </Stack>
      </Card>
    </div>
  );
}
