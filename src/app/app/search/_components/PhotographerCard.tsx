'use client';

import { Card, Group, Text, Title, Badge, Stack } from '@mantine/core';
import { useHover } from '@mantine/hooks';
import Link from 'next/link';
import { Avatar } from '~/app/_components/Avatar';
import type { RouterOutputs } from '~/trpc/react';

type PhotographerCardProps = {
  photographer: RouterOutputs['search']['searchAll']['photographers'][number];
};

export default function PhotographerCard({ photographer }: PhotographerCardProps) {
  const { hovered, ref } = useHover();
  const displayName = `${photographer.user.firstName || ''} ${photographer.user.lastName || ''}`.trim() || photographer.name;

  return (
    <div ref={ref}>
      <Card shadow={hovered ? "xl" : "sm"} p="xl" radius="md" withBorder>
        <Link href={`/app/photographer/${photographer.user.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Group wrap="nowrap">
            <Avatar
              src={photographer.user.profilePic}
              alt={displayName}
              size="xl"
            />
            <Stack gap="xs" style={{ flex: 1 }}>
              <Group justify="space-between" wrap="wrap">
                <Title order={3}>{photographer.name}</Title>
                {photographer.location && (
                  <Badge variant="light" size="lg">
                    {photographer.location}
                  </Badge>
                )}
              </Group>
              {photographer.companyName && (
                <Text size="sm" c="dimmed" fw={500}>
                  {photographer.companyName}
                </Text>
              )}
              {photographer.bio && (
                <Text size="sm" c="dimmed" lineClamp={2}>
                  {photographer.bio}
                </Text>
              )}
            </Stack>
          </Group>
        </Link>
      </Card>
    </div>
  );
}
