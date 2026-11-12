import type Stripe from "stripe";

import { planForPriceId, type PriceConfig } from "~/server/_utils/pricing";

import { isTerminalStatus } from "./entitlements";

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

const fromUnix = (seconds: number | null | undefined): Date | null =>
  typeof seconds === "number" ? new Date(seconds * 1000) : null;

/** The id of an expandable field: Stripe sends either the id or the object. */
export function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
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
 * Among a customer's subscriptions, the one that decides their access: a
 * live (non-terminal) one if there is any, otherwise the most recent.
 */
export function pickPrimarySubscription(
  subscriptions: readonly Stripe.Subscription[],
): Stripe.Subscription | null {
  const newestFirst = [...subscriptions].sort((a, b) => b.created - a.created);
  return newestFirst.find((sub) => !isTerminalStatus(sub.status)) ?? newestFirst[0] ?? null;
}
