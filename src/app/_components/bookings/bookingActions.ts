import {
  BOOKING_TRANSITIONS,
  type BookingAction,
  type BookingRole,
  type BookingStatus,
  checkTransition,
} from "~/server/_db/bookingTransitions";

/**
 * Which booking actions a card offers. Everything here is derived from the
 * server's own transition table (BOOKING_TRANSITIONS) and its check
 * (checkTransition), so the buttons cannot drift from what
 * booking.updateStatus accepts: an action is offered exactly when the
 * server would allow the viewer's role to perform it on this booking now.
 */

type BookingSituation = {
  event: { date: Date; duration: number };
  now: Date;
  status: string;
  /** "sent": the viewer is the applicant. "received": the viewer owns the event. */
  variant: "sent" | "received";
};

/** The order buttons appear in: the constructive action first, the one that ends things after it. */
export const ACTION_ORDER = ["accept", "decline", "withdraw", "cancel", "complete"] as const satisfies readonly BookingAction[];

/**
 * The status `booking.updateStatus` is sent to perform each action: the
 * transition's target. ("withdraw" and "cancel" both send "canceled"; the
 * server tells them apart by the booking's current status.)
 */
export function requestedStatusFor(action: BookingAction): Exclude<BookingStatus, "applied"> {
  const target = BOOKING_TRANSITIONS[action].to;
  // No transition leads back to "applied" (re-applying is applyToEvent).
  if (target === "applied") throw new Error(`No booking action leads to "applied" (${action})`);
  return target;
}

export function roleFor(variant: BookingSituation["variant"]): BookingRole {
  return variant === "sent" ? "applicant" : "owner";
}

/** Every action the viewer may perform on the booking now, in ACTION_ORDER. */
export function availableBookingActions({ event, now, status, variant }: BookingSituation): BookingAction[] {
  const role = roleFor(variant);
  return ACTION_ORDER.filter((action) => checkTransition(action, role, { status }, event, now) === null);
}

export type BookingCardActions = {
  /** Owner: accept an application (before the event starts). */
  accept: boolean;
  /** Withdraw an application, or cancel an accepted booking (either party, before the event). */
  cancel: boolean;
  /** Either party: mark an accepted booking completed (once the event has ended). */
  complete: boolean;
  /** Owner: decline an application. */
  decline: boolean;
};

/** availableBookingActions as one flag per kind of button. */
export function bookingCardActions(situation: BookingSituation): BookingCardActions {
  const actions = new Set(availableBookingActions(situation));
  return {
    accept: actions.has("accept"),
    cancel: actions.has("withdraw") || actions.has("cancel"),
    complete: actions.has("complete"),
    decline: actions.has("decline"),
  };
}
