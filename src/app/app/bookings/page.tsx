"use client";

import { Alert, Badge, Button, Container, Group, Skeleton, Stack, Tabs, Text, Title } from "@mantine/core";
import {
  IconAlertCircle,
  IconBriefcase,
  IconInbox,
  IconSend,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BOOKINGS_PAGE_SIZE } from "~/_utils/pageSizes";
import { mergePages } from "~/_utils/pagination";
import { userFacingError } from "~/_utils/userError";
import BookingCard from "~/app/_components/bookings/BookingCard";
import {
  BOOKING_GROUPS,
  BOOKING_GROUP_TITLES,
  type BookingGroup,
  bookingGroupSnapshot,
  groupBookings,
  needsReplyLabel,
} from "~/app/_components/bookings/bookingGroups";
import EmptyState from "~/app/_components/EmptyState";
import PageHeader from "~/app/_components/PageHeader";
import { focusInto } from "~/app/_hooks/useFocusNewItems";
import { useNow } from "~/app/_hooks/useNow";
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

/** How many bookings on this tab need the viewer (to answer, or to mark completed). Nothing when none do. */
function NeedsReplyBadge({ count, hasMore }: { count: number; hasMore: boolean }) {
  const label = needsReplyLabel(count, hasMore);
  if (!label) return null;
  return (
    <Badge component="span" size="sm" circle={label.length === 1} data-testid="tab-needs-reply">
      <span aria-hidden>{label}</span>
      <span className="sr-only">, {count} {count === 1 ? "needs" : "need"} you</span>
    </Badge>
  );
}

/** One tab's bookings, in BOOKING_GROUPS sections with headings and counts. */
function GroupedBookings<T extends { id: string; status: string; event: { date: Date; duration: number } }>({
  bookings,
  variant,
  now,
  pinned,
  renderCard,
}: {
  bookings: readonly T[];
  variant: "sent" | "received";
  now: Date;
  pinned: ReadonlyMap<string, BookingGroup> | null;
  renderCard: (booking: T) => React.ReactNode;
}) {
  const groups = groupBookings(bookings, variant, now, pinned);
  return (
    <Stack gap="xl">
      {BOOKING_GROUPS.filter((group) => groups[group].length > 0).map((group) => {
        const headingId = `bookings-${variant}-${group}`;
        return (
          <Stack key={group} gap="sm" component="section" aria-labelledby={headingId} data-testid={`group-${group}`}>
            <Title order={2} size="h5" id={headingId}>
              {BOOKING_GROUP_TITLES[group]}{" "}
              <Text span c="var(--iso-text-secondary)" fw={500} inherit>
                ({groups[group].length})
              </Text>
            </Title>
            {groups[group].map(renderCard)}
          </Stack>
        );
      })}
    </Stack>
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
  // After "Load more", focus the first card that was not there before: new
  // bookings can land in any group, so it is found by id, not by position.
  const listRef = useRef<HTMLDivElement>(null);
  const idsBefore = useRef<Set<string> | null>(null);
  const cardIds = () =>
    [...(listRef.current?.querySelectorAll<HTMLElement>("[data-booking-id]") ?? [])].map((card) => card.dataset.bookingId ?? "");
  const expectMore = () => {
    idsBefore.current = new Set(cardIds());
  };
  useEffect(() => {
    const before = idsBefore.current;
    if (!before || loaded <= before.size) return;
    idsBefore.current = null;
    const firstNew = cardIds().find((id) => !before.has(id));
    if (firstNew) focusInto(listRef.current?.querySelector(`[data-booking-id="${CSS.escape(firstNew)}"]`));
  }, [loaded]);
  if (isPending) return <BookingsSkeleton label={loadingLabel} />;
  if (error && loaded === 0) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />} title={`We couldn't load ${noun}`}>
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
      <div ref={listRef}>{children}</div>
      {hasMore && (
        <Stack gap={6} align="center" mt="xs">
          <Text size="sm" c="dimmed" role="status">
            Showing the {loaded} most recent
          </Text>
          <Button
            variant="default"
            onClick={() => {
              expectMore();
              onLoadMore();
            }}
            loading={isLoadingMore}
          >
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

const TABS = ["applications", "received"] as const;
type BookingsTab = (typeof TABS)[number];
const isTab = (value: string | null): value is BookingsTab => TABS.some((tab) => tab === value);

export default function BookingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  // `?tab=received` opens the second tab (linked from "View applications").
  const requestedTab = useSearchParams().get("tab");
  const tab: BookingsTab = isTab(requestedTab) ? requestedTab : "applications";
  const sent = api.booking.getMyApplicationsPage.useInfiniteQuery({ limit: BOOKINGS_PAGE_SIZE }, pageOptions);
  const received = api.booking.getReceivedApplicationsPage.useInfiniteQuery({ limit: BOOKINGS_PAGE_SIZE }, pageOptions);

  const myApplications = mergePages(sent.data?.pages);
  const receivedApplications = mergePages(received.data?.pages);
  // Grouping depends on the time: a booking moves to "Past" when its event ends.
  const now = useNow();
  // While a card's confirmation is open, every card keeps the group it had
  // then: one that moved (its event started or ended, or it was updated)
  // would be remounted elsewhere and take the open dialog with it.
  const [pinned, setPinned] = useState<Map<string, BookingGroup> | null>(null);
  const onDialogOpenChange = (open: boolean) =>
    setPinned(
      open
        ? new Map([
            ...bookingGroupSnapshot(myApplications, "sent", now),
            ...bookingGroupSnapshot(receivedApplications, "received", now),
          ])
        : null,
    );
  const sentNeedingReply = groupBookings(myApplications, "sent", now, pinned).needsReply.length;
  const receivedNeedingReply = groupBookings(receivedApplications, "received", now, pinned).needsReply.length;

  return (
    <Container size="md" py="md" px={0}>
      <Stack gap="lg">
        <PageHeader
          title="Bookings"
          description="Manage your applications and incoming requests"
        />

        <Tabs
          value={tab}
          onChange={(value) => {
            if (isTab(value)) router.replace(value === "applications" ? pathname : `${pathname}?tab=${value}`, { scroll: false });
          }}
        >
          <Tabs.List>
            <Tabs.Tab
              value="applications"
              leftSection={<IconSend size={16} aria-hidden />}
              rightSection={<NeedsReplyBadge count={sentNeedingReply} hasMore={sent.hasNextPage} />}
            >
              My applications
            </Tabs.Tab>
            <Tabs.Tab
              value="received"
              leftSection={<IconInbox size={16} aria-hidden />}
              rightSection={<NeedsReplyBadge count={receivedNeedingReply} hasMore={received.hasNextPage} />}
            >
              Received
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
              <GroupedBookings
                bookings={myApplications}
                variant="sent"
                now={now}
                pinned={pinned}
                renderCard={(booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    event={booking.event}
                    user={booking.owner}
                    variant="sent"
                    onDialogOpenChange={onDialogOpenChange}
                  />
                )}
              />
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
              <GroupedBookings
                bookings={receivedApplications}
                variant="received"
                now={now}
                pinned={pinned}
                renderCard={(booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    event={booking.event}
                    user={booking.applicant}
                    variant="received"
                    onDialogOpenChange={onDialogOpenChange}
                  />
                )}
              />
            </PanelState>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
