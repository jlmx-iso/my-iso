/**
 * What to tell a member who has just come back from Stripe Checkout.
 *
 * The `?checkout=` query parameter only says what the browser was sent back
 * with; it is not proof of payment. Whether the member is on Pro comes from
 * the server's subscription record, which the Stripe webhook can update a few
 * seconds after the redirect.
 */

/** How many times to re-check the subscription after a successful checkout. */
export const CHECKOUT_MAX_ATTEMPTS = 6;
/** Delay between those checks. */
export const CHECKOUT_RETRY_DELAY_MS = 2_000;

export type CheckoutReturn = "success" | "canceled" | null;

export type CheckoutBannerState =
  /** No checkout in progress: show nothing. */
  | "none"
  /** The member backed out of Stripe Checkout. Nothing was charged. */
  | "canceled"
  /** Paid, and the subscription is active. */
  | "confirmed"
  /** Paid (by the redirect's account), waiting for the subscription to show up. */
  | "confirming"
  /** Still not active after every retry: tell them it can take a minute. */
  | "delayed";

/** Reads `?checkout=`; anything but the two known values means "no checkout". */
export function parseCheckoutReturn(value: string | string[] | undefined | null): CheckoutReturn {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "success" || first === "canceled" ? first : null;
}

export function checkoutBannerState({
  checkout,
  isSubscriptionActive,
  attempts,
  maxAttempts = CHECKOUT_MAX_ATTEMPTS,
}: {
  checkout: CheckoutReturn;
  isSubscriptionActive: boolean;
  /** Completed re-checks since the page loaded. */
  attempts: number;
  maxAttempts?: number;
}): CheckoutBannerState {
  if (checkout === null) return "none";
  if (checkout === "canceled") return isSubscriptionActive ? "none" : "canceled";
  if (isSubscriptionActive) return "confirmed";
  return attempts >= maxAttempts ? "delayed" : "confirming";
}
