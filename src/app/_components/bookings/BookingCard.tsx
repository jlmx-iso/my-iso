"use client";

import { Badge, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import {
  IconBan,
  IconCalendar,
  IconCheck,
  IconChecks,
  IconClock,
  IconHourglass,
  IconMapPin,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";

import { logger } from "~/_utils";
import {
  type BookingAction,
  type BookingRole,
  applicationOfBooking,
  bookingHint,
  bookingStatusView,
  formatRate,
} from "~/_utils/bookings";
import { ErrorReason, getErrorReason } from "~/_utils/errorReason";
import { fullName } from "~/_utils/names";
import { userFacingError } from "~/_utils/userError";
import { Avatar } from "~/app/_components/Avatar";
import ConfirmDialog from "~/app/_components/ConfirmDialog";
import { routeFailure } from "~/app/_components/dialogFailure";
import LocalDate from "~/app/_components/LocalDate";
import { useLatestRef } from "~/app/_hooks/useLatestRef";
import { notify } from "~/app/_lib/notify";
import { api } from "~/trpc/react";

import { availableBookingActions, requestedStatusFor } from "./bookingActions";
import { useNowAtBoundaries } from "./boundaryClock";

type BookingUser = {
  firstName: string;
  id: string;
  lastName: string;
  profilePic: string | null;
};

type BookingEvent = {
  date: Date;
  /** Hours; with the date, when the event is over. */
  duration: number;
  id: string;
  location: string;
  title: string;
};

type BookingCardProps = {
  booking: {
    /** How a canceled booking ended, when the server says. */
    cancelOrigin?: string | null;
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
  /**
   * Told when this card's confirmation opens and closes, so the list can
   * keep the card where it is meanwhile (see `pinned` in groupBookings).
   */
  onDialogOpenChange?: (open: boolean) => void;
};

const HOUR_MS = 60 * 60 * 1000;

const STATUS_ICONS: Record<string, typeof IconCheck> = {
  accepted: IconCheck,
  applied: IconHourglass,
  canceled: IconBan,
  completed: IconChecks,
  declined: IconX,
};

type ActionView = {
  /** The button on the card. */
  label: string;
  color?: string;
  variant: "filled" | "default" | "light";
  /** Asked before a destructive action goes through. */
  confirm?: { body: string; cancelLabel: string; confirmLabel: string; title: string };
  success: { message: string; title: string };
};

function actionView(action: BookingAction, role: BookingRole, name: string, eventTitle: string): ActionView {
  switch (action) {
    case "accept":
      return {
        color: "teal",
        label: "Accept",
        success: { message: `${name} is booked for ${eventTitle}.`, title: "Application accepted" },
        variant: "filled",
      };
    case "decline":
      return {
        confirm: {
          body: `${name} will be told their application to ${eventTitle} wasn't accepted. This can't be undone.`,
          cancelLabel: "Keep application",
          confirmLabel: "Decline application",
          title: "Decline this application?",
        },
        label: "Decline",
        success: { message: `${name}'s application to ${eventTitle} was declined.`, title: "Application declined" },
        variant: "default",
      };
    case "withdraw":
      return {
        confirm: {
          body: `${name} will be told you withdrew from ${eventTitle}. You can apply again while the event is still open.`,
          cancelLabel: "Keep application",
          confirmLabel: "Withdraw application",
          title: "Withdraw your application?",
        },
        label: "Withdraw application",
        success: { message: `Your application to ${eventTitle} has been withdrawn.`, title: "Application withdrawn" },
        variant: "default",
      };
    case "cancel":
      return {
        confirm: {
          body:
            role === "owner"
              ? `${name} is booked for ${eventTitle} and will be told it is off. The booking can't be reopened.`
              : `${name} is counting on you for ${eventTitle} and will be told you canceled. The booking can't be reopened.`,
          cancelLabel: "Keep booking",
          confirmLabel: "Cancel booking",
          title: "Cancel this booking?",
        },
        label: "Cancel booking",
        success: { message: `The booking for ${eventTitle} has been canceled.`, title: "Booking canceled" },
        variant: "default",
      };
    case "complete":
      return {
        label: "Mark as completed",
        success: { message: `${eventTitle} is marked as completed. You can now review each other.`, title: "Booking completed" },
        variant: "filled",
      };
  }
}

/** Reasons that mean "what you were looking at is out of date". */
const STALE_REASONS: ReadonlySet<string> = new Set([
  ErrorReason.BOOKING_INVALID_TRANSITION,
  ErrorReason.BOOKING_EVENT_FILLED,
  ErrorReason.BOOKING_EVENT_STARTED,
  ErrorReason.BOOKING_NOT_YET_COMPLETABLE,
]);

export default function BookingCard({ booking, event, user, variant, onDialogOpenChange }: BookingCardProps) {
  const utils = api.useUtils();
  const [confirming, setConfirming] = useState<BookingAction | null>(null);
  const role: BookingRole = variant === "received" ? "owner" : "applicant";
  const name = fullName(user, "the photographer");

  const refresh = () => {
    void utils.booking.getMyApplicationsPage.invalidate();
    void utils.booking.getReceivedApplicationsPage.invalidate();
    void utils.booking.getMyApplications.invalidate();
    void utils.booking.hasApplied.invalidate({ eventId: event.id });
  };

  // A failure of an action confirmed in a dialog is shown in that dialog;
  // one without a dialog (accept, complete) gets a toast.
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // The booking changed under an open confirmation. Refreshing now would
  // move the card to another group, remounting it and taking the dialog and
  // its explanation with it: refresh once the dialog is closed instead.
  const [refreshOnClose, setRefreshOnClose] = useState(false);
  // Whether the confirmation is open when a failure ARRIVES (the request may
  // have been sent from an earlier render).
  const dialogOpen = useLatestRef(confirming !== null);
  const { mutate: updateStatus, isPending, variables } = api.booking.updateStatus.useMutation({
    onError: (error) => {
      logger.error("Error updating booking status", { error });
      const message = userFacingError(error, "Nothing was changed. Please try again.");
      const reason = getErrorReason(error);
      // In the dialog if it is still open; otherwise a toast, and a stale
      // card is refreshed at once (see routeFailure).
      const route = routeFailure({ dialogOpen: dialogOpen.current, stale: !!reason && STALE_REASONS.has(reason) });
      if (route.show === "dialog") setConfirmError(message);
      else notify.error({ message, title: "Booking not updated" });
      if (route.refresh === "now") refresh();
      if (route.refresh === "on-close") setRefreshOnClose(true);
    },
    onSuccess: () => {
      if (confirming) onDialogOpenChange?.(false);
      setConfirming(null);
      setConfirmError(null);
      refresh();
    },
  });

  const perform = (action: BookingAction) => {
    const { success } = actionView(action, role, name, event.title);
    updateStatus(
      { bookingId: booking.id, status: requestedStatusFor(action) },
      { onSuccess: () => notify.success(success) },
    );
  };

  // What can be done changes when the event starts and when it ends: the
  // card's clock moves at exactly those moments.
  const startsAt = new Date(event.date);
  const now = useNowAtBoundaries([startsAt, new Date(startsAt.getTime() + event.duration * HOUR_MS)]);
  // Which buttons: exactly what the server's transition rules allow this
  // viewer's role now (see availableBookingActions).
  const actions = availableBookingActions({
    event: { date: startsAt, duration: event.duration },
    now,
    status: booking.status,
    variant,
  });
  const situation = { event, now, role, status: booking.status };
  const hint = bookingHint({ ...situation, canReapply: applicationOfBooking(booking).canReapply });
  const status = bookingStatusView(booking.status);
  const StatusIcon = STATUS_ICONS[booking.status];
  const rate = formatRate(booking.rate);
  const confirmView = confirming ? actionView(confirming, role, name, event.title).confirm : undefined;

  return (
    <Paper p="md" radius="md" withBorder component="article" data-testid="booking-card" data-status={booking.status} data-booking-id={booking.id}>
      <Stack gap="sm">
        {/* Header: event info and status badge */}
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Title order={3} size="h5" style={{ overflowWrap: "anywhere" }}>
              <Link href={`/app/events/${event.id}`}>{event.title}</Link>
            </Title>
            <Group gap="sm" style={{ rowGap: 2 }}>
              <Group gap={4} wrap="nowrap">
                <IconCalendar size={14} color="var(--mantine-color-gray-7)" aria-hidden />
                <Text size="sm" c="gray.7">
                  <span className="sr-only">When: </span>
                  <LocalDate date={event.date} format="dayTime" />
                </Text>
              </Group>
              <Group gap={4} wrap="nowrap">
                <IconMapPin size={14} color="var(--mantine-color-gray-7)" aria-hidden />
                <Text size="sm" c="gray.7">
                  <span className="sr-only">Where: </span>
                  {event.location}
                </Text>
              </Group>
            </Group>
          </Stack>
          <Badge
            variant={status.variant}
            color={status.color}
            leftSection={StatusIcon ? <StatusIcon size={12} aria-hidden /> : undefined}
            style={{ flexShrink: 0, textTransform: "none" }}
            data-testid="booking-status"
          >
            <span className="sr-only">Status: </span>
            {status.label}
          </Badge>
        </Group>

        {/* The other person */}
        <Group gap="sm" wrap="nowrap">
          <Avatar src={user.profilePic} name={name} alt="" size="md" />
          <Stack gap={0} style={{ minWidth: 0 }}>
            {/* The link truncates itself (.ellipsis): a truncating parent would
                clip its enlarged hit area and lose the ellipsis. */}
            <Text size="sm" fw={600}>
              <Link href={`/app/photographer/${user.id}`} className="tap-link ellipsis">{name}</Link>
            </Text>
            <Text size="xs" c="dimmed">
              {variant === "sent" ? "Event owner" : "Applicant"}
            </Text>
          </Stack>
        </Group>

        {/* What the applicant offered, and the owner's reply */}
        {(rate || booking.notes || booking.ownerNotes) && (
          <Stack gap={6}>
            {rate && (
              <Text size="sm">
                <Text span fw={600}>Rate: </Text>
                {rate}
              </Text>
            )}
            {booking.notes && (
              <Text size="sm" style={{ overflowWrap: "anywhere", whiteSpace: "pre-line" }}>
                <Text span fw={600}>{variant === "sent" ? "Your note: " : "Their note: "}</Text>
                {booking.notes}
              </Text>
            )}
            {booking.ownerNotes && (
              <Text size="sm" style={{ overflowWrap: "anywhere", whiteSpace: "pre-line" }}>
                <Text span fw={600}>{variant === "sent" ? "Owner's reply: " : "Your reply: "}</Text>
                {booking.ownerNotes}
              </Text>
            )}
          </Stack>
        )}

        {actions.length > 0 && (
          <Group gap="xs" mt={4}>
            {actions.map((action) => {
              const view = actionView(action, role, name, event.title);
              return (
                <Button
                  key={action}
                  size="sm"
                  className="touch-target"
                  variant={view.variant}
                  color={view.color}
                  leftSection={action === "accept" || action === "complete" ? <IconCheck size={16} aria-hidden /> : undefined}
                  onClick={() => {
                    setConfirmError(null);
                    if (view.confirm) {
                      setConfirming(action);
                      onDialogOpenChange?.(true);
                    }
                    else perform(action);
                  }}
                  loading={isPending && variables?.status === requestedStatusFor(action)}
                  disabled={isPending && variables?.status !== requestedStatusFor(action)}
                  data-testid={`booking-${action}`}
                >
                  {view.label}
                </Button>
              );
            })}
          </Group>
        )}

        {hint && (
          <Group gap={6} wrap="nowrap" align="flex-start" data-testid="booking-hint">
            <IconClock size={14} color="var(--mantine-color-gray-7)" style={{ flexShrink: 0, marginTop: 3 }} aria-hidden />
            <Text size="sm" c="gray.7">{hint}</Text>
          </Group>
        )}

        <Text size="xs" c="dimmed">
          Applied <LocalDate date={booking.createdAt} />
        </Text>
      </Stack>

      {confirmView && confirming && (
        <ConfirmDialog
          opened
          onClose={() => {
            // Not while the request runs (ConfirmDialog does not offer it either).
            if (isPending) return;
            setConfirming(null);
            setConfirmError(null);
            onDialogOpenChange?.(false);
            if (refreshOnClose) {
              setRefreshOnClose(false);
              refresh();
            }
          }}
          onConfirm={() => perform(confirming)}
          error={confirmError}
          errorTitle="Booking not updated"
          // The booking changed under the dialog: retrying would fail again.
          closeOnly={refreshOnClose}
          title={confirmView.title}
          confirmLabel={confirmView.confirmLabel}
          cancelLabel={confirmView.cancelLabel}
          destructive
          loading={isPending}
        >
          {confirmView.body}
        </ConfirmDialog>
      )}
    </Paper>
  );
}
