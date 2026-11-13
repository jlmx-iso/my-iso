/**
 * Bookings as the browser sees them: which actions to offer, what each
 * status is called, and how an application to an event stands.
 *
 * WHICH actions a card offers, and the status each one sends, are derived
 * from the server's transition table in
 * ~/app/_components/bookings/bookingActions;
 * this module holds what goes around them: labels, hints, money.
 */

export const BOOKING_STATUSES = ["applied", "accepted", "declined", "completed", "canceled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type BookingRole = "applicant" | "owner";
export type BookingAction = "accept" | "decline" | "withdraw" | "cancel" | "complete";

export function isBookingStatus(value: unknown): value is BookingStatus {
  return BOOKING_STATUSES.some((status) => status === value);
}

const HOUR_MS = 60 * 60 * 1000;

/** The part of an event that decides what can be done with its bookings. */
export type BookingEventTimes = {
  /** When the event starts. */
  date: Date | string;
  /** Its length in hours. Unknown is treated as none: over as soon as it starts. */
  duration?: number | null;
};

/** Where an event is in time: accepting and cancelling stop at the start, completing begins at the end. */
export function eventPhase(event: BookingEventTimes, now: Date = new Date()): "before" | "during" | "after" {
  const start = new Date(event.date).getTime();
  if (now.getTime() < start) return "before";
  const end = start + Math.max(0, event.duration ?? 0) * HOUR_MS;
  return now.getTime() < end ? "during" : "after";
}

export type BookingSituation = {
  role: BookingRole;
  status: string;
  event: BookingEventTimes;
  now?: Date;
};

/**
 * A line under the actions when the status alone does not explain what can
 * (or cannot yet) be done.
 */
export function bookingHint({
  role,
  status,
  event,
  canReapply = false,
  now = new Date(),
}: BookingSituation & { canReapply?: boolean }): string | null {
  const phase = eventPhase(event, now);
  if (status === "accepted") {
    if (phase === "before") return "You can mark this booking as completed once the event is over.";
    if (phase === "during") return "The event is under way. You can mark the booking as completed once it is over.";
    return null;
  }
  if (status === "applied" && phase !== "before") {
    return role === "owner"
      ? "This event has already started, so the application can no longer be accepted."
      : "This event has already started. You can still withdraw your application.";
  }
  if (status === "canceled" && role === "applicant" && canReapply && phase === "before") {
    return "Changed your mind? You can apply again from the event page.";
  }
  if (status === "completed") return "You can now leave each other a review from your profiles.";
  return null;
}

type StatusView = { color: string; label: string; variant: "light" | "filled" | "outline" };

const STATUS_VIEWS: Record<BookingStatus, StatusView> = {
  accepted: { color: "teal", label: "Accepted", variant: "light" },
  applied: { color: "gray", label: "Awaiting reply", variant: "light" },
  canceled: { color: "gray", label: "Canceled", variant: "outline" },
  // Solid, so a finished booking never reads like a refused one.
  completed: { color: "teal", label: "Completed", variant: "filled" },
  declined: { color: "red", label: "Declined", variant: "light" },
};

/** Label and colour of a status badge. Unknown statuses are shown as they are, in grey. */
export function bookingStatusView(status: string): StatusView {
  if (isBookingStatus(status)) return STATUS_VIEWS[status];
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ") : "Unknown";
  return { color: "gray", label, variant: "outline" };
}

const wholeDollars = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });
const dollarsAndCents = new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" });

/**
 * The rate an applicant typed. People write "$50/hr" or "negotiable", which
 * is shown as written; a bare number ("400.0") is an amount in dollars.
 */
export function formatRate(rate: string | null | undefined): string | null {
  const text = rate?.trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const amount = Number(text);
    return (Number.isInteger(amount) ? wholeDollars : dollarsAndCents).format(amount);
  }
  return text;
}

/**
 * How the viewer's own application to an event stands, for the apply
 * control: the shape `booking.hasApplied` answers with (see applyButtonState
 * in ~/app/_components/bookings/applyButton), plus the booking's status for
 * the badge.
 */
export type Application = {
  applyBlockedBy?: "event_not_found" | "event_started" | "event_filled" | null;
  canReapply: boolean;
  hasApplied: boolean;
  status: string | null;
};

export const NOT_APPLIED: Application = { canReapply: false, hasApplied: false, status: null };

/**
 * The same, from one of the viewer's own bookings (the feed learns about
 * every card's application from one list). Only an application the
 * applicant withdrew can be sent again (`cancelOrigin`).
 */
export function applicationOfBooking(booking: { status: string; cancelOrigin?: string | null }): Application {
  return {
    canReapply: booking.status === "canceled" && booking.cancelOrigin === "withdrawn",
    hasApplied: true,
    status: booking.status,
  };
}

/** The viewer's application for each event they have applied to. */
export function applicationsByEvent(
  bookings: ReadonlyArray<{ eventId: string; status: string; cancelOrigin?: string | null }>,
): Map<string, Application> {
  return new Map(bookings.map((booking) => [booking.eventId, applicationOfBooking(booking)]));
}

/**
 * Why an event takes no applications, as far as a feed row shows it (the
 * detail page asks the server, which also knows about deleted events).
 */
export function applyBlockerOf(
  event: { date: Date | string; isFulfilled?: boolean },
  now: Date,
): "event_started" | "event_filled" | null {
  if (new Date(event.date).getTime() <= now.getTime()) return "event_started";
  return event.isFulfilled ? "event_filled" : null;
}
