import { availableBookingActions } from "./bookingActions";

/**
 * The sections of a bookings list, in the order they are shown:
 *
 * - `needsReply`: the viewer has to do something: answer an application, or
 *   mark a booking completed once its event is over. Exactly the bookings
 *   whose card shows one of those buttons (availableBookingActions), so the
 *   section and the buttons cannot disagree.
 * - `upcoming`: still open, and the event has not ended.
 * - `past`: the event is over (completed, or nothing left to do).
 * - `closed`: declined or canceled.
 */
export const BOOKING_GROUPS = ["needsReply", "upcoming", "past", "closed"] as const;
export type BookingGroup = (typeof BOOKING_GROUPS)[number];

export const BOOKING_GROUP_TITLES: Record<BookingGroup, string> = {
  closed: "Closed",
  needsReply: "Needs your reply",
  past: "Past",
  upcoming: "Upcoming",
};

const HOUR_MS = 60 * 60 * 1000;
const CLOSED_STATUSES: ReadonlySet<string> = new Set(["declined", "canceled"]);
/** Actions that answer something. Withdrawing or cancelling is always possible and asks nothing of the viewer. */
const REPLIES: ReadonlySet<string> = new Set(["accept", "decline", "complete"]);

type GroupableBooking = {
  id: string;
  status: string;
  event: { date: Date | string; duration: number };
};

export function bookingGroupOf(
  booking: GroupableBooking,
  variant: "sent" | "received",
  now: Date,
): BookingGroup {
  if (CLOSED_STATUSES.has(booking.status)) return "closed";
  const event = { date: new Date(booking.event.date), duration: booking.event.duration };
  const actions = availableBookingActions({ event, now, status: booking.status, variant });
  if (actions.some((action) => REPLIES.has(action))) return "needsReply";
  const endsAt = event.date.getTime() + Math.max(0, event.duration) * HOUR_MS;
  if (booking.status === "completed" || endsAt <= now.getTime()) return "past";
  return "upcoming";
}

/**
 * The bookings sorted into BOOKING_GROUPS. What needs a reply and what is
 * upcoming come soonest event first; past and closed, most recent first.
 */
export function groupBookings<T extends GroupableBooking>(
  bookings: readonly T[],
  variant: "sent" | "received",
  now: Date,
): Record<BookingGroup, T[]> {
  const groups: Record<BookingGroup, T[]> = { closed: [], needsReply: [], past: [], upcoming: [] };
  for (const booking of bookings) groups[bookingGroupOf(booking, variant, now)].push(booking);
  const at = (booking: T) => new Date(booking.event.date).getTime();
  const soonestFirst = (a: T, b: T) => at(a) - at(b) || a.id.localeCompare(b.id);
  const latestFirst = (a: T, b: T) => at(b) - at(a) || a.id.localeCompare(b.id);
  groups.needsReply.sort(soonestFirst);
  groups.upcoming.sort(soonestFirst);
  groups.past.sort(latestFirst);
  groups.closed.sort(latestFirst);
  return groups;
}

/**
 * The number on a bookings tab: how many need the viewer's reply. "3+"
 * while more bookings can be loaded (some of those may need a reply too);
 * nothing when none of the loaded ones do.
 */
export function needsReplyLabel(count: number, hasMore: boolean): string | null {
  if (count === 0) return null;
  return hasMore ? `${count}+` : String(count);
}
