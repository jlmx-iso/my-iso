import { Card, Skeleton, Stack, Group } from '@mantine/core';

export function EventSearchCardSkeleton() {
  return (
    <Card shadow="sm" p="xl" radius="md" withBorder>
      <Group justify="space-between" mb="md" wrap="wrap">
        <Skeleton height={14} width={100} />
        <Group gap="xs">
          <Skeleton height={24} width={80} />
          <Skeleton height={20} width={60} />
        </Group>
      </Group>

      <Skeleton height={12} width={120} mb="xs" />
      <Skeleton height={24} width="60%" mb="xs" />
      <Skeleton height={16} width="80%" />

      <Skeleton height={200} mt="md" radius="md" />

      <Group justify="space-between" mt="md">
        <Skeleton height={12} width={80} />
        <Skeleton height={12} width={60} />
      </Group>
    </Card>
  );
}

export function PhotographerSearchCardSkeleton() {
  return (
    <Card shadow="sm" p="xl" radius="md" withBorder>
      <Group wrap="nowrap">
        <Skeleton height={80} width={80} radius="xl" />
        <Stack gap="xs" style={{ flex: 1 }}>
          <Group justify="space-between" wrap="wrap">
            <Skeleton height={24} width={150} />
            <Skeleton height={28} width={100} radius="md" />
          </Group>
          <Skeleton height={14} width={120} />
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="70%" />
        </Stack>
      </Group>
    </Card>
  );
}

export default function SearchLoadingSkeleton({ type = 'all' }: { type?: 'all' | 'photographers' | 'events' }) {
  return (
    <Stack gap="md" mt="xl">
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
