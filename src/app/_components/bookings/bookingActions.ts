import { type BookingAction, type BookingRole, checkTransition } from "~/server/_db/bookingTransitions";

type BookingCardActionsInput = {
  event: { date: Date; duration: number };
  now: Date;
  status: string;
  /** "sent": the viewer is the applicant. "received": the viewer owns the event. */
  variant: "sent" | "received";
};

export type BookingCardActions = {
  /** Owner: accept an application (before the event starts). */
  accept: boolean;
  /** Applicant: withdraw an application, or cancel an accepted booking. */
  cancel: boolean;
  /** Either party: mark an accepted booking completed. */
  complete: boolean;
  /** Owner: decline an application. */
  decline: boolean;
};

/**
 * Which buttons the booking card offers. Each is shown only when
 * booking.updateStatus would accept it now, decided by the server's own
 * rule (checkTransition): an accepted booking can be cancelled only before
 * the event starts and completed only after it has ended (its start plus
 * `duration` hours); an application can be withdrawn at any time.
 *
 * As before, the card gives the event owner no button to cancel an accepted
 * booking, although the server would allow it before the event.
 */
export function bookingCardActions({ event, now, status, variant }: BookingCardActionsInput): BookingCardActions {
  const role: BookingRole = variant === "sent" ? "applicant" : "owner";
  const allowed = (action: BookingAction) => checkTransition(action, role, { status }, event, now) === null;

  return {
    accept: allowed("accept"),
    cancel: role === "applicant" && (allowed("withdraw") || allowed("cancel")),
    complete: allowed("complete"),
    decline: allowed("decline"),
  };
}
