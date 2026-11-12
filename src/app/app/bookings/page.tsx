"use client";

import { Alert, Button, Container, Group, Skeleton, Stack, Tabs, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconBriefcase,
  IconInbox,
  IconSend,
} from "@tabler/icons-react";
import Link from "next/link";

import { BOOKINGS_PAGE_SIZE } from "~/_utils/pageSizes";
import { loadedCountLabel, mergePages } from "~/_utils/pagination";
import { userFacingError } from "~/_utils/userError";
import BookingCard from "~/app/_components/bookings/BookingCard";
import EmptyState from "~/app/_components/EmptyState";
import PageHeader from "~/app/_components/PageHeader";
import { api } from "~/trpc/react";

const pageOptions = {
  getNextPageParam: (lastPage: { nextCursor: string | null }) => lastPage.nextCursor ?? undefined,
};

function BookingsSkeleton({ label }: { label: string }) {
  return (
    <Stack gap="sm" aria-busy="true" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={132} radius="md" />
      ))}
    </Stack>
  );
}

/** "(12)", or "(20+)" while more can be loaded; nothing for an empty list. */
function TabCount({ loaded, hasMore }: { loaded: number; hasMore: boolean }) {
  if (loaded === 0) return null;
  return (
    <Text span size="xs" c="dimmed" ml={4}>
      ({loadedCountLabel(loaded, hasMore)})
      {hasMore && <span className="sr-only"> loaded, more available</span>}
    </Text>
  );
}

type PanelStateProps = {
  children: React.ReactNode;
  empty: React.ReactNode;
  error: unknown;
  hasMore: boolean;
  isEmpty: boolean;
  isLoadingMore: boolean;
  isLoadMoreError: boolean;
  isPending: boolean;
  loaded: number;
  loadingLabel: string;
  noun: string;
  onLoadMore: () => void;
  onRetry: () => void;
};

/** Loading, error, empty and "load more" around one tab's list. */
function PanelState({
  children,
  empty,
  error,
  hasMore,
  isEmpty,
  isLoadingMore,
  isLoadMoreError,
  isPending,
  loaded,
  loadingLabel,
  noun,
  onLoadMore,
  onRetry,
}: PanelStateProps) {
  if (isPending) return <BookingsSkeleton label={loadingLabel} />;
  if (error && loaded === 0) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />} title={`We couldn't load ${noun}`} role="alert">
        {userFacingError(error, "Please try again.")}
        <Group mt="xs">
          <Button variant="default" size="xs" onClick={onRetry}>
            Try again
          </Button>
        </Group>
      </Alert>
    );
  }
  if (isEmpty) return <>{empty}</>;

  return (
    <Stack gap="sm">
      {children}
      {hasMore && (
        <Stack gap={6} align="center" mt="xs">
          <Text size="sm" c="dimmed" role="status">
            Showing the {loaded} most recent
          </Text>
          <Button variant="default" onClick={onLoadMore} loading={isLoadingMore}>
            Load more
          </Button>
          {isLoadMoreError && (
            <Text size="sm" c="red" role="alert">
              We couldn&apos;t load more. Please try again.
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}

export default function BookingsPage() {
  const sent = api.booking.getMyApplicationsPage.useInfiniteQuery({ limit: BOOKINGS_PAGE_SIZE }, pageOptions);
  const received = api.booking.getReceivedApplicationsPage.useInfiniteQuery({ limit: BOOKINGS_PAGE_SIZE }, pageOptions);

  const myApplications = mergePages(sent.data?.pages);
  const receivedApplications = mergePages(received.data?.pages);

  return (
    <Container size="md" py="md" px={0}>
      <Stack gap="lg">
        <PageHeader
          title="Bookings"
          description="Manage your applications and incoming requests"
        />

        <Tabs defaultValue="applications">
          <Tabs.List>
            <Tabs.Tab value="applications" leftSection={<IconSend size={16} />}>
              My applications
              <TabCount loaded={myApplications.length} hasMore={sent.hasNextPage} />
            </Tabs.Tab>
            <Tabs.Tab value="received" leftSection={<IconInbox size={16} />}>
              Received
              <TabCount loaded={receivedApplications.length} hasMore={received.hasNextPage} />
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="applications" pt="md">
            <PanelState
              isPending={sent.isPending}
              error={sent.error}
              isEmpty={!!sent.data && myApplications.length === 0}
              loaded={myApplications.length}
              hasMore={sent.hasNextPage}
              isLoadingMore={sent.isFetchingNextPage}
              isLoadMoreError={sent.isFetchNextPageError}
              onLoadMore={() => void sent.fetchNextPage()}
              onRetry={() => void sent.refetch()}
              loadingLabel="Loading your applications"
              noun="your applications"
              empty={
                <EmptyState
                  icon={IconBriefcase}
                  title="No applications yet"
                  description="Browse events and apply to second shoot opportunities you're interested in."
                  action={
                    <Button component={Link} href="/app/events">
                      Browse events
                    </Button>
                  }
                />
              }
            >
              {myApplications.map((booking) => (
                <BookingCard
                  key={booking.id}
                  booking={booking}
                  event={booking.event}
                  user={booking.owner}
                  variant="sent"
                />
              ))}
            </PanelState>
          </Tabs.Panel>

          <Tabs.Panel value="received" pt="md">
            <PanelState
              isPending={received.isPending}
              error={received.error}
              isEmpty={!!received.data && receivedApplications.length === 0}
              loaded={receivedApplications.length}
              hasMore={received.hasNextPage}
              isLoadingMore={received.isFetchingNextPage}
              isLoadMoreError={received.isFetchNextPageError}
              onLoadMore={() => void received.fetchNextPage()}
              onRetry={() => void received.refetch()}
              loadingLabel="Loading received applications"
              noun="received applications"
              empty={
                <EmptyState
                  icon={IconInbox}
                  title="No applications received"
                  description="When someone applies to one of your events, it will appear here."
                />
              }
            >
              {receivedApplications.map((booking) => (
                <BookingCard
                  key={booking.id}
                  booking={booking}
                  event={booking.event}
                  user={booking.applicant}
                  variant="received"
                />
              ))}
            </PanelState>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
