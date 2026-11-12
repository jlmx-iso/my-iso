import { logger } from "~/_utils";

import type { ExtendedPrismaClient } from "./softDelete";

/**
 * The booking state machine.
 *
 *              withdraw (applicant)
 *   applied ───────────────────────────▶ canceled
 *      │  decline (owner)
 *      ├───────────────────────────────▶ declined
 *      │  accept (owner, before the event, event not yet filled)
 *      ▼
 *   accepted ── cancel (either, before the event) ──▶ canceled
 *      │
 *      └────── complete (either, after the event has ENDED) ──▶ completed
 *
 * `declined`, `canceled` and `completed` are final, with one exception: an
 * applicant who WITHDREW an application may apply again
 * (booking.applyToEvent). How a booking was cancelled is recorded in
 * Booking.cancelOrigin; a booking the owner declined, or that either party
 * cancelled after it had been accepted, is never reopened.
 *
 * The event "has ended" at its start plus its duration (Event.duration, in
 * hours): a ten-hour job that began a minute ago is not complete, and
 * cannot be reviewed yet.
 *
 * An event has ONE second-shooter slot: the schema models "filled" as the
 * boolean Event.isFulfilled, not a number of places. So at most one booking
 * of an event is accepted (or completed) at a time, and isFulfilled mirrors
 * whether there is one.
 */

export const BOOKING_STATUSES = ["applied", "accepted", "declined", "completed", "canceled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type BookingRole = "applicant" | "owner";
export type BookingAction = "withdraw" | "accept" | "decline" | "cancel" | "complete";

type Transition = {
  by: readonly BookingRole[];
  from: BookingStatus;
  to: BookingStatus;
  /**
   * When the action is possible: at any time, only before the event
   * starts, or only after it has ended.
   */
  when: "any_time" | "before_event" | "after_event";
};

export const BOOKING_TRANSITIONS: Record<BookingAction, Transition> = {
  accept: { by: ["owner"], from: "applied", to: "accepted", when: "before_event" },
  cancel: { by: ["applicant", "owner"], from: "accepted", to: "canceled", when: "before_event" },
  complete: { by: ["applicant", "owner"], from: "accepted", to: "completed", when: "after_event" },
  decline: { by: ["owner"], from: "applied", to: "declined", when: "any_time" },
  withdraw: { by: ["applicant"], from: "applied", to: "canceled", when: "any_time" },
};

/** Statuses that occupy the event's slot. */
export const SLOT_HOLDING_STATUSES = ["accepted", "completed"] as const satisfies readonly BookingStatus[];

/**
 * Which action a requested target status means. "canceled" is a withdrawal
 * of an application or the cancellation of an accepted booking, depending
 * on where the booking is.
 */
export function actionFor(
  target: Exclude<BookingStatus, "applied">,
  currentStatus: string,
): BookingAction {
  switch (target) {
    case "accepted":
      return "accept";
    case "declined":
      return "decline";
    case "completed":
      return "complete";
    case "canceled":
      return currentStatus === "accepted" ? "cancel" : "withdraw";
  }
}

export type TransitionRefusal =
  /** The caller's role may not perform this action. */
  | "not_allowed"
  /** The booking is not in the state the action starts from. */
  | "invalid_transition"
  /** The event has started: too late to accept or cancel. */
  | "event_started"
  /** The event has not happened yet: too early to complete. */
  | "not_yet_completable";

const HOUR_MS = 60 * 60 * 1000;

/** When an event is over: its start plus its duration (hours, at least 0). */
export function eventEndsAt(event: { date: Date; duration: number }): Date {
  return new Date(event.date.getTime() + Math.max(0, event.duration) * HOUR_MS);
}

/** Why `role` may not perform `action` on a booking now, or null if they may. */
export function checkTransition(
  action: BookingAction,
  role: BookingRole,
  booking: { status: string },
  event: { date: Date; duration: number },
  now: Date,
): TransitionRefusal | null {
  const transition = BOOKING_TRANSITIONS[action];
  if (!transition.by.includes(role)) return "not_allowed";
  if (booking.status !== transition.from) return "invalid_transition";
  const started = event.date.getTime() <= now.getTime();
  const ended = eventEndsAt(event).getTime() <= now.getTime();
  if (transition.when === "before_event" && started) return "event_started";
  if (transition.when === "after_event" && !ended) return "not_yet_completable";
  return null;
}

/** How a canceled booking ended (Booking.cancelOrigin). */
export const CANCEL_ORIGINS = ["withdrawn", "canceled_by_applicant", "canceled_by_owner"] as const;
export type CancelOrigin = (typeof CANCEL_ORIGINS)[number];

/** The only cancellation after which the applicant may apply again. */
export const REAPPLIABLE_CANCEL_ORIGIN = "withdrawn" satisfies CancelOrigin;

function cancelOriginFor(action: BookingAction, role: BookingRole): CancelOrigin | null {
  if (action === "withdraw") return "withdrawn";
  if (action === "cancel") return role === "owner" ? "canceled_by_owner" : "canceled_by_applicant";
  return null;
}

/** Whether the applicant of this booking may apply to the event again. */
export function canReapply(booking: { cancelOrigin: string | null; status: string }): boolean {
  return booking.status === "canceled" && booking.cancelOrigin === REAPPLIABLE_CANCEL_ORIGIN;
}

type BookingDb = Pick<ExtendedPrismaClient, "booking" | "event">;

/**
 * Performs `action` if the booking is still in the state it starts from.
 *
 * One conditional UPDATE: of two requests racing on the same booking (two
 * accepts; an accept against a withdrawal) exactly one finds the expected
 * status and wins. Accepting also requires, in the same statement, that no
 * other booking holds the event's slot, so two applicants cannot both be
 * accepted. Returns false when nothing was updated.
 */
export async function applyTransition(
  db: BookingDb,
  bookingId: string,
  action: BookingAction,
  role: BookingRole,
  extra: { ownerNotes?: string } = {},
): Promise<boolean> {
  const transition = BOOKING_TRANSITIONS[action];
  const result = await db.booking.updateMany({
    data: {
      // Written with the status, in the same statement: who cancelled is
      // never out of step with the fact that it is cancelled.
      cancelOrigin: cancelOriginFor(action, role),
      status: transition.to,
      ...(extra.ownerNotes !== undefined ? { ownerNotes: extra.ownerNotes } : {}),
    },
    where: {
      id: bookingId,
      isDeleted: false,
      status: transition.from,
      ...(action === "accept"
        ? {
            event: {
              bookings: {
                none: {
                  id: { not: bookingId },
                  isDeleted: false,
                  status: { in: [...SLOT_HOLDING_STATUSES] },
                },
              },
              isDeleted: false,
            },
          }
        : {}),
    },
  });
  return result.count > 0;
}

/** Whether another booking already holds the event's slot. */
export async function isSlotTaken(db: BookingDb, eventId: string, exceptBookingId?: string): Promise<boolean> {
  const holder = await db.booking.findFirst({
    select: { id: true },
    where: {
      eventId,
      status: { in: [...SLOT_HOLDING_STATUSES] },
      ...(exceptBookingId ? { id: { not: exceptBookingId } } : {}),
    },
  });
  return holder !== null;
}

/** Event ids per lookup statement (D1 accepts about 100 bound parameters). */
const FULFILLED_LOOKUP_CHUNK = 80;

/**
 * Sets `isFulfilled` on each event from the bookings themselves: true when
 * a booking holds the event's slot. This is what every read of an event
 * returns.
 *
 * The stored column Event.isFulfilled is only a copy (kept for the
 * previous release and for ad-hoc queries), written after a transition by
 * syncEventFulfilled in a separate statement that can fail. Reading the
 * truth instead means a failed or missed write can never leave an event
 * showing the wrong state. One query per FULFILLED_LOOKUP_CHUNK events.
 */
export async function withDerivedFulfilled<T extends { id: string; isFulfilled: boolean }>(
  db: Pick<ExtendedPrismaClient, "booking">,
  events: readonly T[],
): Promise<T[]> {
  const fulfilled = new Set<string>();
  for (let start = 0; start < events.length; start += FULFILLED_LOOKUP_CHUNK) {
    const ids = events.slice(start, start + FULFILLED_LOOKUP_CHUNK).map((event) => event.id);
    const holders = await db.booking.findMany({
      distinct: ["eventId"],
      select: { eventId: true },
      where: { eventId: { in: ids }, status: { in: [...SLOT_HOLDING_STATUSES] } },
    });
    for (const holder of holders) fulfilled.add(holder.eventId);
  }
  return events.map((event) => ({ ...event, isFulfilled: fulfilled.has(event.id) }));
}

/**
 * Makes the stored Event.isFulfilled say whether a booking holds the
 * event's slot.
 *
 * Two conditional statements, each of which looks at the bookings as they
 * are when it runs, so the flag converges on the truth whatever else is
 * happening and however often this is called. A failure is logged, not
 * thrown: the booking transition has already happened. Nothing the app
 * shows depends on this write succeeding: reads derive the value
 * (withDerivedFulfilled), and reading a single event repairs the column.
 */
export async function syncEventFulfilled(db: BookingDb, eventId: string): Promise<void> {
  const holdsSlot = { isDeleted: false, status: { in: [...SLOT_HOLDING_STATUSES] } };
  try {
    await db.event.updateMany({
      data: { isFulfilled: true },
      where: { bookings: { some: holdsSlot }, id: eventId, isFulfilled: false },
    });
    await db.event.updateMany({
      data: { isFulfilled: false },
      where: { bookings: { none: holdsSlot }, id: eventId, isFulfilled: true },
    });
  } catch (error) {
    logger.error("Failed to update Event.isFulfilled", { error, eventId });
  }
}
