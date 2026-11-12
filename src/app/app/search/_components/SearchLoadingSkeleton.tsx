import { Card, Skeleton, Stack, Group } from '@mantine/core';

const accentStyle = {
  borderLeft: '3px solid var(--mantine-color-orange-3)',
};

export function EventSearchCardSkeleton() {
  return (
    <Card shadow="xs" p={0} radius="md" withBorder style={accentStyle}>
      {/* Hero image placeholder */}
      <Skeleton height={160} radius={0} />

      <Stack gap="xs" p="md">
        {/* UserBadge + date row */}
        <Group justify="space-between" align="center">
          <Group gap="sm" align="center">
            <Skeleton height={38} width={38} radius="xl" />
            <Skeleton height={14} width={100} />
          </Group>
          <Skeleton height={12} width={70} />
        </Group>

        {/* Title */}
        <Skeleton height={20} width="65%" />
        {/* Description */}
        <Skeleton height={14} width="85%" />

        {/* Badges + counts */}
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <Skeleton height={18} width={70} radius="md" />
            <Skeleton height={18} width={80} radius="md" />
            <Skeleton height={18} width={55} radius="md" />
          </Group>
          <Group gap="sm">
            <Skeleton height={12} width={30} />
            <Skeleton height={12} width={30} />
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}

export function PhotographerSearchCardSkeleton() {
  return (
    <Card shadow="xs" p="md" radius="md" withBorder style={accentStyle}>
      <Stack gap="sm">
        {/* Header: avatar + info + button */}
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Skeleton height={48} width={48} radius="xl" />
            <Stack gap={4}>
              <Skeleton height={16} width={120} />
              <Skeleton height={12} width={90} />
              <Skeleton height={12} width={80} />
            </Stack>
          </Group>
          <Skeleton height={24} width={80} radius="sm" />
        </Group>

        {/* Bio */}
        <Skeleton height={14} width="90%" />
        <Skeleton height={14} width="70%" />

        {/* Thumbnail row */}
        <Group gap="xs">
          <Skeleton height={56} width={72} radius="sm" />
          <Skeleton height={56} width={72} radius="sm" />
          <Skeleton height={56} width={72} radius="sm" />
          <Skeleton height={56} width={72} radius="sm" />
        </Group>
      </Stack>
    </Card>
  );
}

export default function SearchLoadingSkeleton({ type = 'all' }: { type?: 'all' | 'photographers' | 'events' }) {
  return (
    <Stack gap="sm">
      {(type === 'all' || type === 'photographers') && (
        <>
          <PhotographerSearchCardSkeleton />
          <PhotographerSearchCardSkeleton />
        </>
      )}
      {(type === 'all' || type === 'events') && (
        <>
          <EventSearchCardSkeleton />
          <EventSearchCardSkeleton />
        </>
      )}
    </Stack>
  );
}
