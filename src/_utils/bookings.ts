/**
 * Bookings as the browser sees them: which actions to offer, what each
 * status is called, and how an application to an event stands.
 *
 * The rules mirror the server's state machine
 * (src/server/_db/bookingTransitions.ts); bookings.test.ts checks the two
 * against each other, so a button is only shown when the server would accept
 * the request it sends.
 */

export const BOOKING_STATUSES = ["applied", "accepted", "declined", "completed", "canceled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type BookingRole = "applicant" | "owner";
export type BookingAction = "accept" | "decline" | "withdraw" | "cancel" | "complete";

/** The status `booking.updateStatus` is asked for to perform each action. */
export const ACTION_TARGET_STATUS = {
  accept: "accepted",
  cancel: "canceled",
  complete: "completed",
  decline: "declined",
  withdraw: "canceled",
} as const satisfies Record<BookingAction, Exclude<BookingStatus, "applied">>;

/** Actions that end something for the other person: asked twice. */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<BookingAction> = new Set(["decline", "cancel", "withdraw"]);

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

type BookingSituation = {
  role: BookingRole;
  status: string;
  event: BookingEventTimes;
  now?: Date;
};

/** What `role` can do with a booking right now, most important first. */
export function availableBookingActions({ role, status, event, now = new Date() }: BookingSituation): BookingAction[] {
  const phase = eventPhase(event, now);
  if (status === "applied") {
    if (role === "applicant") return ["withdraw"];
    // An application to an event that has started can only be declined.
    return phase === "before" ? ["accept", "decline"] : ["decline"];
  }
  if (status === "accepted") {
    if (phase === "before") return ["cancel"];
    // Under way: too late to cancel, too early to call it done.
    return phase === "after" ? ["complete"] : [];
  }
  return [];
}

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
  applied: { color: "blue", label: "Awaiting reply", variant: "light" },
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

/** How the viewer's own application to an event stands. */
export type ApplicationStatus = "none" | BookingStatus;

export type Application = {
  status: ApplicationStatus;
  /** The server will accept a new application in place of this one. */
  canReapply: boolean;
};

const NO_APPLICATION: Application = { canReapply: false, status: "none" };

function readField(value: object, key: string): unknown {
  return key in value ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Reads the answer of `booking.hasApplied`, whichever shape it has: a plain
 * boolean, `{ hasApplied }`, `{ hasApplied, status }`, or that with
 * `canReapply`. An application whose status is missing or not one we know
 * counts as "applied".
 *
 * Only an application the applicant withdrew can be sent again. A server
 * that says so (`canReapply`) is believed; one that does not yet is assumed
 * to allow it for any canceled application, and refuses if it does not.
 */
export function applicationOf(value: unknown): Application {
  if (typeof value === "boolean") return value ? { canReapply: false, status: "applied" } : NO_APPLICATION;
  if (typeof value !== "object" || value === null) return NO_APPLICATION;

  const rawStatus = readField(value, "status");
  const hasApplied = readField(value, "hasApplied");
  let status: ApplicationStatus = "none";
  if (isBookingStatus(rawStatus)) status = rawStatus;
  else if (hasApplied === true || (typeof rawStatus === "string" && rawStatus !== "")) status = "applied";

  const stated = readField(value, "canReapply");
  const canReapply = status === "canceled" && (typeof stated === "boolean" ? stated : true);
  return { canReapply, status };
}

/**
 * The same, from one of the viewer's own bookings. `cancelOrigin` (how a
 * canceled booking ended) decides when the server sends it; without it any
 * canceled application is assumed to be reopenable.
 */
export function applicationOfBooking(booking: { status: string; cancelOrigin?: string | null }): Application {
  const application = applicationOf({ hasApplied: true, status: booking.status });
  if (application.status !== "canceled" || !("cancelOrigin" in booking)) return application;
  return { ...application, canReapply: booking.cancelOrigin === "withdrawn" };
}

/** Whether the viewer can send (or send again) an application. */
export function canApply({
  application,
  eventDate,
  isFilled = false,
  now = new Date(),
}: {
  application: Application;
  eventDate: Date | string;
  isFilled?: boolean;
  now?: Date;
}): boolean {
  if (new Date(eventDate).getTime() < now.getTime()) return false;
  if (isFilled) return false;
  return application.status === "none" || application.canReapply;
}

/** The viewer's application for each event they have applied to. */
export function applicationsByEvent(
  bookings: ReadonlyArray<{ eventId: string; status: string; cancelOrigin?: string | null }>,
): Map<string, Application> {
  return new Map(bookings.map((booking) => [booking.eventId, applicationOfBooking(booking)]));
}
