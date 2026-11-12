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
 *      └────── complete (either, after the event) ──▶ completed
 *
 * `declined`, `canceled` and `completed` are final, except that an applicant
 * who withdrew may apply again (booking.applyToEvent).
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
  /** When, relative to the event's start, the action is possible. */
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

/** Why `role` may not perform `action` on a booking now, or null if they may. */
export function checkTransition(
  action: BookingAction,
  role: BookingRole,
  booking: { status: string },
  eventDate: Date,
  now: Date,
): TransitionRefusal | null {
  const transition = BOOKING_TRANSITIONS[action];
  if (!transition.by.includes(role)) return "not_allowed";
  if (booking.status !== transition.from) return "invalid_transition";
  const started = eventDate.getTime() <= now.getTime();
  if (transition.when === "before_event" && started) return "event_started";
  if (transition.when === "after_event" && !started) return "not_yet_completable";
  return null;
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
  extra: { ownerNotes?: string } = {},
): Promise<boolean> {
  const transition = BOOKING_TRANSITIONS[action];
  const result = await db.booking.updateMany({
    data: {
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

/**
 * Makes Event.isFulfilled say whether a booking holds the event's slot.
 *
 * Two conditional statements, each of which looks at the bookings as they
 * are when it runs, so the flag converges on the truth whatever else is
 * happening and however often this is called. A failure is logged, not
 * thrown: the booking transition has already happened, and the next
 * transition on the event repairs the flag.
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
