"use client";

import {
  Avatar,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCalendar,
  IconCheck,
  IconMapPin,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";

import { logger } from "~/_utils";
import { api } from "~/trpc/react";

const STATUS_COLORS: Record<string, string> = {
  accepted: "teal",
  applied: "blue",
  canceled: "gray",
  completed: "orange",
  declined: "red",
};

type BookingUser = {
  firstName: string;
  id: string;
  lastName: string;
  profilePic: string | null;
};

type BookingEvent = {
  date: Date;
  id: string;
  location: string;
  title: string;
};

type BookingCardProps = {
  booking: {
    createdAt: Date;
    id: string;
    notes: string | null;
    ownerNotes: string | null;
    rate: string | null;
    status: string;
  };
  event: BookingEvent;
  /** "sent" = I applied to someone else's event. "received" = someone applied to my event. */
  variant: "sent" | "received";
  /** The other party (owner if I'm the applicant, applicant if I'm the owner) */
  user: BookingUser;
};

export default function BookingCard({
  booking,
  event,
  user,
  variant,
}: BookingCardProps) {
  const utils = api.useUtils();

  const { mutate: updateStatus, isPending } =
    api.booking.updateStatus.useMutation({
      onError: (error) => {
        logger.error("Error updating booking status", { error });
        notifications.show({
          color: "red",
          message: error.message ?? "Something went wrong.",
          title: "Update Failed",
        });
      },
      onSuccess: () => {
        notifications.show({
          color: "teal",
          icon: <IconCheck size={16} />,
          message: "Booking status updated.",
          title: "Updated",
        });
        void utils.booking.getMyApplications.invalidate();
        void utils.booking.getReceivedApplications.invalidate();
      },
    });

  const handleAccept = () => {
    updateStatus({ bookingId: booking.id, status: "accepted" });
  };

  const handleDecline = () => {
    updateStatus({ bookingId: booking.id, status: "declined" });
  };

  const handleCancel = () => {
    updateStatus({ bookingId: booking.id, status: "canceled" });
  };

  const handleComplete = () => {
    updateStatus({ bookingId: booking.id, status: "completed" });
  };

  return (
    <Paper p="md" radius="md" withBorder>
      <Stack gap="sm">
        {/* Header: event info and status badge */}
        <Group justify="space-between" align="flex-start">
          <Stack gap={4} style={{ flex: 1 }}>
            <Link
              href={`/app/events/${event.id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <Text fw={600} size="md" lineClamp={1}>
                {event.title}
              </Text>
            </Link>
            <Group gap="xs">
              <Group gap={4}>
                <IconMapPin size={14} color="var(--mantine-color-dimmed)" />
                <Text size="xs" c="dimmed">
                  {event.location}
                </Text>
              </Group>
              <Group gap={4}>
                <IconCalendar size={14} color="var(--mantine-color-dimmed)" />
                <Text size="xs" c="dimmed">
                  {new Date(event.date).toLocaleDateString()}
                </Text>
              </Group>
            </Group>
          </Stack>
          <Badge
            variant="light"
            color={STATUS_COLORS[booking.status] ?? "gray"}
            size="sm"
          >
            {booking.status}
          </Badge>
        </Group>

        {/* User info */}
        <Group gap="sm">
          <Avatar
            src={user.profilePic}
            alt={`${user.firstName} ${user.lastName}`}
            size="sm"
            radius="xl"
          />
          <Stack gap={0}>
            <Text size="sm" fw={500}>
              {user.firstName} {user.lastName}
            </Text>
            <Text size="xs" c="dimmed">
              {variant === "sent" ? "Event Owner" : "Applicant"}
            </Text>
          </Stack>
        </Group>

        {/* Rate and notes */}
        {booking.rate && (
          <Group gap={4}>
            <Text size="xs" fw={500}>
              Rate:
            </Text>
            <Text size="xs" c="dimmed">
              {booking.rate}
            </Text>
          </Group>
        )}

        {booking.notes && (
          <Stack gap={2}>
            <Text size="xs" fw={500}>
              Notes:
            </Text>
            <Text size="xs" c="dimmed" lineClamp={3}>
              {booking.notes}
            </Text>
          </Stack>
        )}

        {booking.ownerNotes && (
          <Stack gap={2}>
            <Text size="xs" fw={500}>
              Owner Response:
            </Text>
            <Text size="xs" c="dimmed" lineClamp={3}>
              {booking.ownerNotes}
            </Text>
          </Stack>
        )}

        {/* Actions */}
        <Group gap="xs" mt={4}>
          {/* Owner actions: accept/decline for "applied" status */}
          {variant === "received" && booking.status === "applied" && (
            <>
              <Button
                size="xs"
                color="teal"
                leftSection={<IconCheck size={14} />}
                onClick={handleAccept}
                loading={isPending}
              >
                Accept
              </Button>
              <Button
                size="xs"
                color="red"
                variant="light"
                leftSection={<IconX size={14} />}
                onClick={handleDecline}
                loading={isPending}
              >
                Decline
              </Button>
            </>
          )}

          {/* Applicant can cancel if still applied or accepted */}
          {variant === "sent" &&
            (booking.status === "applied" ||
              booking.status === "accepted") && (
              <Button
                size="xs"
                color="gray"
                variant="light"
                onClick={handleCancel}
                loading={isPending}
              >
                Cancel Application
              </Button>
            )}

          {/* Either party can mark as completed if accepted */}
          {booking.status === "accepted" && (
            <Button
              size="xs"
              variant="light"
              onClick={handleComplete}
              loading={isPending}
            >
              Mark Completed
            </Button>
          )}
        </Group>

        {/* Timestamp */}
        <Text size="xs" c="dimmed">
          Applied {new Date(booking.createdAt).toLocaleDateString()}
        </Text>
      </Stack>
    </Paper>
  );
}
