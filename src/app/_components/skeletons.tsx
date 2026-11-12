import { Box, Group, Paper, SimpleGrid, Skeleton, Stack } from "@mantine/core";

import EventCardSkeleton from "./events/EventCardSkeleton";

/**
 * Route-level loading states (`loading.tsx`). Each mirrors the layout of the
 * page it stands in for, so content does not jump when it arrives.
 */

function Busy({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

/** Title, description and (optionally) the primary action of a PageHeader. */
export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <Group justify="space-between" align="center">
      <Stack gap={8}>
        <Skeleton height={28} width={160} radius="sm" />
        <Skeleton height={14} width={260} maw="70vw" radius="sm" />
      </Stack>
      {withAction && <Skeleton height={36} width={130} radius="md" />}
    </Group>
  );
}

export function EventsFeedSkeleton() {
  return (
    <Busy label="Loading events">
      <Stack gap="lg">
        <PageHeaderSkeleton withAction />
        <Group gap="lg">
          <Skeleton height={20} width={90} radius="sm" />
          <Skeleton height={20} width={60} radius="sm" />
        </Group>
        <Skeleton height={18} width={200} radius="sm" />
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {[0, 1, 2, 3].map((i) => (
            <EventCardSkeleton key={i} />
          ))}
        </SimpleGrid>
      </Stack>
    </Busy>
  );
}

export function EventDetailSkeleton() {
  return (
    <Busy label="Loading event">
      <Stack gap="md" maw={760} mx="auto">
        <Skeleton height={14} width={110} radius="sm" />
        <Group justify="space-between">
          <Group gap="sm">
            <Skeleton height={38} width={38} radius="xl" />
            <Skeleton height={14} width={120} radius="sm" />
          </Group>
          <Skeleton height={12} width={70} radius="sm" />
        </Group>
        <Skeleton height={30} width="70%" radius="sm" />
        <Skeleton height={14} width="95%" radius="sm" />
        <Skeleton height={14} width="80%" radius="sm" />
        <Skeleton height={320} radius="md" />
        <Group gap="xs">
          <Skeleton height={20} width={90} radius="xl" />
          <Skeleton height={20} width={100} radius="xl" />
          <Skeleton height={20} width={70} radius="xl" />
        </Group>
        <Skeleton height={20} width={120} radius="sm" mt="md" />
        <Skeleton height={56} radius="md" />
        <Skeleton height={56} radius="md" />
      </Stack>
    </Busy>
  );
}

export function ProfileSkeleton() {
  return (
    <Busy label="Loading profile">
      <Stack gap="xl">
        <Box>
          <Skeleton h={{ base: 180, sm: 280 }} radius="lg" />
          <Box px={{ base: "xs", sm: "xl" }} mt={-56} pos="relative">
            <Skeleton height={120} width={120} circle style={{ border: "4px solid var(--mantine-color-body)" }} />
            <Stack gap={10} mt="sm">
              <Skeleton height={28} width={220} radius="sm" />
              <Skeleton height={14} width={260} maw="80%" radius="sm" />
              <Skeleton height={14} width="90%" maw={640} radius="sm" />
              <Skeleton height={14} width="70%" maw={520} radius="sm" />
            </Stack>
          </Box>
        </Box>
        <Stack gap="md">
          <Skeleton height={22} width={110} radius="sm" />
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing={{ base: "xs", sm: "sm" }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} radius="md" style={{ aspectRatio: "1 / 1" }} />
            ))}
          </SimpleGrid>
        </Stack>
      </Stack>
    </Busy>
  );
}

export function SettingsSkeleton() {
  return (
    <Busy label="Loading settings">
      <Stack gap="xl" maw={720} mx="auto" py="lg">
        <PageHeaderSkeleton />
        <Paper withBorder p="xl" radius="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap="xs">
              <Skeleton height={22} width={180} radius="sm" />
              <Skeleton height={14} width={300} maw="70vw" radius="sm" />
            </Stack>
            <Skeleton height={42} width={200} radius="md" />
          </Group>
        </Paper>
        <Skeleton height={22} width={160} radius="sm" />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          <Skeleton height={260} radius="md" />
          <Skeleton height={260} radius="md" />
        </SimpleGrid>
      </Stack>
    </Busy>
  );
}

/** Conversation rows, for the messages list pane. */
export function ConversationListSkeleton() {
  return (
    <Stack gap={0}>
      {[0, 1, 2, 3].map((i) => (
        <Group key={i} wrap="nowrap" gap="sm" px="md" py="sm">
          <Skeleton height={38} width={38} radius="xl" style={{ flexShrink: 0 }} />
          <Stack gap={6} style={{ flex: 1 }}>
            <Skeleton height={14} width="50%" radius="sm" />
            <Skeleton height={12} width="85%" radius="sm" />
          </Stack>
        </Group>
      ))}
    </Stack>
  );
}

/** Header, bubbles and composer, for the thread pane. */
export function ThreadSkeleton() {
  return (
    <Busy label="Loading conversation">
      <Stack gap="sm" p="sm" h="100%">
        <Group gap="xs">
          <Skeleton height={26} width={26} radius="xl" />
          <Skeleton height={16} width={140} radius="sm" />
        </Group>
        <Stack gap="xs" style={{ flex: 1 }} justify="flex-end">
          <Skeleton height={40} width="55%" radius="lg" />
          <Skeleton height={40} width="40%" radius="lg" style={{ alignSelf: "flex-end" }} />
          <Skeleton height={56} width="60%" radius="lg" />
          <Skeleton height={40} width="35%" radius="lg" style={{ alignSelf: "flex-end" }} />
        </Stack>
        <Skeleton height={42} radius="md" />
      </Stack>
    </Busy>
  );
}

export function MessagesSkeleton() {
  return (
    <Busy label="Loading messages">
      <Stack gap="md">
        <PageHeaderSkeleton withAction />
        <Paper withBorder radius="md" mih={420}>
          <ConversationListSkeleton />
        </Paper>
      </Stack>
    </Busy>
  );
}

export function OnboardingSkeleton() {
  return (
    <Busy label="Loading">
      <Stack align="center" gap="lg" maw={640} mx="auto" py="xl">
        <Skeleton height={80} width={80} circle />
        <Skeleton height={30} width={280} maw="80%" radius="sm" />
        <Skeleton height={16} width={340} maw="90%" radius="sm" />
        <Skeleton height={220} width="100%" radius="md" />
      </Stack>
    </Busy>
  );
}
