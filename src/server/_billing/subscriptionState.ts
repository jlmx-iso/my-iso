import type Stripe from "stripe";

import { planForPriceId, type PriceConfig } from "~/server/_utils/pricing";

import { CANCELLATION_REQUESTED, isEntitlingStatus, isTerminalStatus } from "./entitlements";

/**
 * A Stripe subscription reduced to what this app stores. Derived only from a
 * subscription object read from the Stripe API (never from the body of a
 * webhook event, which may be stale by the time it arrives).
 */
export type SubscriptionState = {
  cancelAt: Date | null;
  cancelAtPeriodEnd: boolean;
  cancellationReason: string | null;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  endedAt: Date | null;
  interval: string | null;
  /** The subscription's latest invoice (in_...). */
  latestInvoiceId: string | null;
  /**
   * End of the current period when its (latest) invoice is paid, else null.
   * Needs `latest_invoice` expanded; a reading without it counts as unpaid.
   */
  paidThroughAt: Date | null;
  plan: string | null;
  priceId: string | null;
  /** Stripe's `status`, verbatim (see SUBSCRIPTION_STATUSES). */
  status: string;
  stripeCreatedAt: Date;
  stripeCustomerId: string;
  /** Stripe's clock when the subscription was read. */
  stripeSyncedAt: Date;
  subscriptionId: string;
};

/**
 * `expand` for every subscription read: whether the current period was paid
 * for is a property of the latest invoice.
 */
export const SUBSCRIPTION_EXPAND = ["latest_invoice"];
/** The same, for `subscriptions.list`. */
export const SUBSCRIPTION_LIST_EXPAND = ["data.latest_invoice"];

const fromUnix = (seconds: number | null | undefined): Date | null =>
  typeof seconds === "number" ? new Date(seconds * 1000) : null;

/** The id of an expandable field: Stripe sends either the id or the object. */
export function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** The expanded object of an expandable field, or null when only the id came. */
function expanded<T extends { id: string }>(value: string | T | null | undefined): T | null {
  return value && typeof value !== "string" ? value : null;
}

/**
 * The item that is the plan. Subscriptions sold here have exactly one item;
 * if there are several (edited by hand in the dashboard), prefer one whose
 * price is a configured plan.
 */
function planItem(
  subscription: Stripe.Subscription,
  prices: PriceConfig | undefined,
): Stripe.SubscriptionItem | null {
  const items = subscription.items.data;
  return items.find((item) => planForPriceId(item.price.id, prices) !== null) ?? items[0] ?? null;
}

/**
 * End of the current period if it was paid for: the latest invoice is
 * `paid` (a trial's zero-amount invoice counts). An open, uncollectible or
 * void invoice, or a reading without the invoice, means it was not.
 *
 * The latest invoice is normally the one for the current period. When it is
 * an unpaid invoice for something else (a mid-period plan change), the
 * period counts as unpaid: this errs towards no access.
 */
function paidThrough(subscription: Stripe.Subscription, periodEnd: Date | null): Date | null {
  return expanded(subscription.latest_invoice)?.status === "paid" ? periodEnd : null;
}

export function subscriptionStateFromStripe(
  subscription: Stripe.Subscription,
  syncedAt: Date,
  prices?: PriceConfig,
): SubscriptionState {
  const item = planItem(subscription, prices);
  // Since API version 2025-03-31 the billing period is a property of each
  // subscription item, no longer of the subscription.
  const currentPeriodStart = fromUnix(item?.current_period_start);
  const currentPeriodEnd = fromUnix(item?.current_period_end);

  // A scheduled cancellation shows up as `cancel_at_period_end`, as an
  // explicit `cancel_at` date, or both, depending on how it was requested.
  const scheduledEnd =
    fromUnix(subscription.cancel_at) ??
    (subscription.cancel_at_period_end ? currentPeriodEnd : null);
  const willCancel =
    !isTerminalStatus(subscription.status) &&
    (subscription.cancel_at_period_end || subscription.cancel_at !== null);

  const customerId = stripeId(subscription.customer);
  if (!customerId) throw new Error(`Stripe subscription ${subscription.id} has no customer`);

  return {
    cancelAt: willCancel ? scheduledEnd : null,
    cancelAtPeriodEnd: willCancel,
    cancellationReason: subscription.cancellation_details?.reason ?? null,
    currentPeriodEnd,
    currentPeriodStart,
    endedAt: fromUnix(subscription.ended_at),
    interval: item?.price.recurring?.interval ?? null,
    latestInvoiceId: stripeId(subscription.latest_invoice),
    paidThroughAt: paidThrough(subscription, currentPeriodEnd),
    plan: item ? (planForPriceId(item.price.id, prices)?.plan ?? null) : null,
    priceId: item?.price.id ?? null,
    status: subscription.status,
    stripeCreatedAt: new Date(subscription.created * 1000),
    stripeCustomerId: customerId,
    stripeSyncedAt: syncedAt,
    subscriptionId: subscription.id,
  };
}

/**
 * When a subscription read as `past_due` became so, as far as one reading
 * can tell: when its unpaid latest invoice was created, and never later than
 * the reading. Used only the FIRST time a subscription is seen past due;
 * from then on the stored `pastDueSince` is kept (see subscriptionStore.ts),
 * which is what stops a new billing period from starting a new grace window.
 */
export function pastDueAnchor(subscription: Stripe.Subscription, syncedAt: Date): Date {
  const invoice = expanded(subscription.latest_invoice);
  const invoiceCreated = invoice && invoice.status !== "paid" ? fromUnix(invoice.created) : null;
  return invoiceCreated && invoiceCreated.getTime() < syncedAt.getTime() ? invoiceCreated : syncedAt;
}

/**
 * How strongly a subscription claims to be the one that decides a user's
 * access. Higher wins; see pickPrimarySubscription and, for the stored row,
 * `outranks` in subscriptionStore.ts (the two must agree).
 *
 * 3. Entitling: `active`, `trialing`, `past_due`.
 * 2. Cancelled on request with paid time left: still carries access.
 * 1. Live but not entitling: `incomplete`, `unpaid`, `paused`, and any
 *    status this code does not know.
 * 0. Finished: `canceled` without paid time left, `incomplete_expired`.
 */
export type SubscriptionPrecedence = 0 | 1 | 2 | 3;

export function subscriptionPrecedence(
  state: Pick<SubscriptionState, "cancellationReason" | "paidThroughAt" | "status">,
  now: Date,
): SubscriptionPrecedence {
  if (isEntitlingStatus(state.status)) return 3;
  if (!isTerminalStatus(state.status)) return 1;
  const paidTimeLeft =
    state.status === "canceled" &&
    state.cancellationReason === CANCELLATION_REQUESTED &&
    state.paidThroughAt !== null &&
    state.paidThroughAt.getTime() > now.getTime();
  return paidTimeLeft ? 2 : 0;
}

/**
 * Among a customer's subscriptions, the one that decides their access: the
 * one with the highest precedence (see subscriptionPrecedence), and among
 * equals the most recently created. So a second, `incomplete` subscription
 * never displaces one that is paid for, and of two paid ones the newer wins.
 */
export function pickPrimarySubscription(
  subscriptions: readonly Stripe.Subscription[],
  now: Date,
  prices?: PriceConfig,
): Stripe.Subscription | null {
  const ranked = subscriptions.map((subscription) => ({
    precedence: subscriptionPrecedence(subscriptionStateFromStripe(subscription, now, prices), now),
    subscription,
  }));
  ranked.sort(
    (a, b) => b.precedence - a.precedence || b.subscription.created - a.subscription.created,
  );
  return ranked[0]?.subscription ?? null;
}

/** What an open or closed dispute means for access. */
export type DisputeStanding =
  /** A chargeback is in progress: access is suspended. */
  | "open"
  /** The payment was taken back. */
  | "lost"
  /** Won, withdrawn, prevented, or only an inquiry: nothing is withheld. */
  | "cleared";

/**
 * - `won`, `warning_closed` (an inquiry that never became a chargeback) and
 *   `prevented` (resolved before it became one; a refund, if any, arrives
 *   as its own event): cleared.
 * - `warning_needs_response`, `warning_under_review`: an inquiry. No money
 *   has been taken back, so access is not suspended; if it escalates, the
 *   dispute's status changes and `charge.dispute.updated` brings it here.
 * - `lost`: lost.
 * - Everything else, including statuses this code does not know: open.
 */
export function disputeStanding(status: string): DisputeStanding {
  switch (status) {
    case "won":
    case "warning_closed":
    case "prevented":
    case "warning_needs_response":
    case "warning_under_review":
      return "cleared";
    case "lost":
      return "lost";
    default:
      return "open";
  }
}
