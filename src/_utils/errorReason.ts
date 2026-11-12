/**
 * Stable, machine-readable reasons the API attaches to some errors, for the
 * client to turn into specific guidance. A tRPC error carries its reason in
 * `error.data.reason` (null when there is none); the HTTP status and tRPC
 * code are unchanged.
 *
 * Values are part of the API contract with the web and mobile clients: add
 * new ones, never rename.
 */
export const ErrorReason = {
  /**
   * `subscription.createCheckoutSession`, `createPortalSession`, `syncStatus`
   * (503): billing cannot be reached or is not configured right now. Nothing
   * was charged; trying again later is safe.
   */
  BILLING_UNAVAILABLE: "billing_unavailable",
  /**
   * `booking.*` transitions (409): the booking is no longer in a state that
   * allows this action (for example it was withdrawn while the owner was
   * accepting it, or it is already completed). Refetch the booking.
   */
  BOOKING_INVALID_TRANSITION: "booking_invalid_transition",
  /**
   * `booking.*` transitions (403): the caller's role in the booking (owner
   * or applicant) may not perform this action.
   */
  BOOKING_NOT_ALLOWED: "booking_not_allowed",
  /**
   * `booking.updateStatus` to `completed` (400): the event has not taken
   * place yet.
   */
  BOOKING_NOT_YET_COMPLETABLE: "booking_not_yet_completable",
  /**
   * `booking.updateStatus` to `accepted`/`canceled`, `booking.applyToEvent`
   * (400): the event has already started.
   */
  BOOKING_EVENT_STARTED: "booking_event_started",
  /**
   * `booking.updateStatus` to `accepted`, `booking.applyToEvent` (409): the
   * event already has its second shooter (another booking was accepted).
   */
  BOOKING_EVENT_FILLED: "booking_event_filled",
  /** `event.getById` (404): no such event, or it was deleted. */
  EVENT_NOT_FOUND: "event_not_found",
  /**
   * `subscription.createPortalSession` (412): the caller has never started
   * a subscription, so there is nothing to manage. Offer checkout.
   */
  NO_BILLING_ACCOUNT: "no_billing_account",
  /** `review.create` (409): the caller has already reviewed this photographer. */
  REVIEW_EXISTS: "review_exists",
  /**
   * `review.create` (403): reviews are for people who worked together; the
   * caller has no completed booking with this photographer.
   */
  REVIEW_NOT_ELIGIBLE: "review_not_eligible",
  /** `review.create` (400): the caller tried to review themselves. */
  REVIEW_SELF: "review_self",
  /**
   * `subscription.createCheckoutSession` (409): the caller already has a
   * subscription (or a comped Pro account). Send them to the billing portal
   * (`subscription.createPortalSession`) instead of a second checkout.
   */
  SUBSCRIPTION_EXISTS: "subscription_exists",
  /**
   * `message.createThread` (429): the caller has opened as many NEW
   * conversations today as their allowance permits. Writing in existing
   * conversations still works.
   */
  NEW_CONVERSATION_LIMIT: "new_conversation_limit",
  /**
   * `photographer.addPortfolioImage` (400): the portfolio already holds the
   * maximum number of images. The error message says so and is safe to show.
   */
  PORTFOLIO_FULL: "portfolio_full",
  /**
   * `message.createThread`, `message.getRecipientById` (403): the caller may
   * not start a conversation with this person (they are not discoverable and
   * there is no match, active booking or earlier message from them), or
   * there is no such person; the two are deliberately indistinguishable.
   */
  RECIPIENT_NOT_MESSAGEABLE: "recipient_not_messageable",
} as const;

export type ErrorReason = (typeof ErrorReason)[keyof typeof ErrorReason];

/**
 * The reason carried by an error thrown by the tRPC client (or anything
 * else), or null.
 */
export function getErrorReason(error: unknown): ErrorReason | null {
  if (typeof error !== "object" || error === null || !("data" in error)) return null;
  const { data } = error;
  if (typeof data !== "object" || data === null || !("reason" in data)) return null;
  const { reason } = data;
  return Object.values(ErrorReason).find((known) => known === reason) ?? null;
}
