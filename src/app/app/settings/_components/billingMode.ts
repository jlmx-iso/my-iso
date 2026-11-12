/**
 * Which billing action the settings page offers, from what the server says
 * about the subscription (`subscription.getStatus`). It mirrors what the
 * server will accept: `createCheckoutSession` is refused while a
 * subscription has not ended, and allowed once it has.
 *
 * - "checkout": no subscription, or one that has ended and gives no access:
 *   "Upgrade to Pro".
 * - "resubscribe": the subscription was cancelled outright and the period
 *   already paid for still gives Pro. A checkout is allowed, but it is not
 *   an upgrade: it starts a NEW subscription that is charged today, on top
 *   of the time that is left. The page says so.
 * - "portal": a subscription that has not ended (running, set to cancel,
 *   past due, paused, unfinished) is managed in the billing portal, whether
 *   or not it currently gives access. Undoing a scheduled cancellation is
 *   done there too.
 * - "none": a comped account.
 */
export type BillingMode = "checkout" | "resubscribe" | "portal" | "none";

export function billingModeFor(
  subscription: { canStartCheckout: boolean; hasProAccess: boolean; isLifetime: boolean } | null,
): BillingMode {
  if (!subscription) return "checkout";
  if (subscription.isLifetime) return "none";
  if (!subscription.canStartCheckout) return "portal";
  return subscription.hasProAccess ? "resubscribe" : "checkout";
}
