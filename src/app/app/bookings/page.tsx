"use client";

import { Container, Stack, Tabs, Text } from "@mantine/core";
import {
  IconBriefcase,
  IconInbox,
  IconSend,
} from "@tabler/icons-react";

import BookingCard from "~/app/_components/bookings/BookingCard";
import EmptyState from "~/app/_components/EmptyState";
import { Loader } from "~/app/_components/Loader";
import PageHeader from "~/app/_components/PageHeader";
import { api } from "~/trpc/react";

export default function BookingsPage() {
  const {
    data: myApplications,
    isPending: myAppsPending,
    isError: myAppsError,
  } = api.booking.getMyApplications.useQuery();

  const {
    data: receivedApplications,
    isPending: receivedPending,
    isError: receivedError,
  } = api.booking.getReceivedApplications.useQuery();

  return (
    <Container size="md" py="md">
      <Stack gap="lg">
        <PageHeader
          title="Bookings"
          description="Manage your applications and incoming requests"
        />

        <Tabs defaultValue="applications">
          <Tabs.List>
            <Tabs.Tab
              value="applications"
              leftSection={<IconSend size={16} />}
            >
              My Applications
              {myApplications && myApplications.length > 0 && (
                <Text span size="xs" c="dimmed" ml={4}>
                  ({myApplications.length})
                </Text>
              )}
            </Tabs.Tab>
            <Tabs.Tab
              value="received"
              leftSection={<IconInbox size={16} />}
            >
              Received
              {receivedApplications && receivedApplications.length > 0 && (
                <Text span size="xs" c="dimmed" ml={4}>
                  ({receivedApplications.length})
                </Text>
              )}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="applications" pt="md">
            {myAppsPending && <Loader />}

            {myAppsError && (
              <Text c="red" size="sm">
                Failed to load your applications. Please try again.
              </Text>
            )}

            {myApplications && myApplications.length === 0 && (
              <EmptyState
                icon={IconBriefcase}
                title="No applications yet"
                description="Browse events and apply to second shoot opportunities you're interested in."
              />
            )}

            {myApplications && myApplications.length > 0 && (
              <Stack gap="sm">
                {myApplications.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    event={booking.event}
                    user={booking.owner}
                    variant="sent"
                  />
                ))}
              </Stack>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="received" pt="md">
            {receivedPending && <Loader />}

            {receivedError && (
              <Text c="red" size="sm">
                Failed to load received applications. Please try again.
              </Text>
            )}

            {receivedApplications && receivedApplications.length === 0 && (
              <EmptyState
                icon={IconInbox}
                title="No applications received"
                description="When someone applies to one of your events, it will appear here."
              />
            )}

            {receivedApplications && receivedApplications.length > 0 && (
              <Stack gap="sm">
                {receivedApplications.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    event={booking.event}
                    user={booking.applicant}
                    variant="received"
                  />
                ))}
              </Stack>
            )}
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
