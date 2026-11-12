import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import { logger } from "~/_utils";
import { isUniqueViolation } from "~/server/_db/errors";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";

import { isTerminalStatus, TERMINAL_STATUSES } from "./entitlements";
import { reportBillingError } from "./report";
import { isStripeResourceMissing, stripeResponseTime } from "./stripe";
import {
  pickPrimarySubscription,
  stripeId,
  subscriptionStateFromStripe,
  type SubscriptionState,
} from "./subscriptionState";

/**
 * Reading and writing the stored billing state.
 *
 * D1 has no interactive transactions, so every write here is a single
 * conditional statement (or an insert guarded by the unique userId), and
 * every function can be repeated or run concurrently with itself.
 */

export type BillingDb = Pick<ExtendedPrismaClient, "subscription" | "user">;

/**
 * The legacy boolean columns, derived from the status. The previous release
 * reads them (isActive meant "Pro"); see the note on model Subscription.
 */
function legacyFlags(state: Pick<SubscriptionState, "cancelAtPeriodEnd" | "currentPeriodEnd" | "status">) {
  const { status } = state;
  return {
    expiresAt: state.currentPeriodEnd,
    isActive: status === "active" || status === "trialing" || status === "past_due",
    isCanceled: state.cancelAtPeriodEnd || status === "canceled",
    isExpired: status === "canceled" || status === "unpaid" || status === "incomplete_expired",
    isPaused: status === "paused",
    isPending: status === "incomplete",
    isTrial: status === "trialing",
  };
}

/** A reading may replace the stored one only if it is not older. */
function notNewerThan(syncedAt: Date): Prisma.SubscriptionWhereInput {
  return { OR: [{ stripeSyncedAt: null }, { stripeSyncedAt: { lte: syncedAt } }] };
}

/**
 * When may `state` overwrite the row?
 *
 * - Same subscription (or a row that never had one): when the reading is at
 *   least as recent as the stored one. This is what makes event order
 *   irrelevant: a late `subscription.updated` handled after `deleted` reads
 *   the same (cancelled) subscription from Stripe, and a slow handler
 *   holding an older reading loses to a faster one with a newer reading.
 * - A different subscription of the same user: a live one replaces a
 *   finished one, a finished one never replaces a live one, and otherwise
 *   the more recently created subscription wins. So a straggling event for
 *   last year's cancelled subscription cannot take away this year's access.
 * - `authoritative`: the caller chose this subscription from the customer's
 *   complete list, so only freshness is checked.
 */
function mayReplace(state: SubscriptionState, authoritative: boolean): Prisma.SubscriptionWhereInput {
  const fresh = notNewerThan(state.stripeSyncedAt);
  if (authoritative) return fresh;

  const createdEarlier: Prisma.SubscriptionWhereInput = {
    OR: [{ stripeCreatedAt: null }, { stripeCreatedAt: { lt: state.stripeCreatedAt } }],
  };
  const storedIsTerminal: Prisma.SubscriptionWhereInput = { status: { in: [...TERMINAL_STATUSES] } };
  const otherSubscription: Prisma.SubscriptionWhereInput = isTerminalStatus(state.status)
    ? { AND: [storedIsTerminal, createdEarlier] }
    : { OR: [storedIsTerminal, createdEarlier] };

  return {
    OR: [
      {
        AND: [
          { OR: [{ subscriptionId: null }, { subscriptionId: state.subscriptionId }] },
          fresh,
        ],
      },
      { AND: [{ subscriptionId: { not: state.subscriptionId } }, otherSubscription] },
    ],
  };
}

/**
 * Stores `state` as the user's subscription unless the row already holds
 * something that must not be replaced (see mayReplace). Returns "stale" in
 * that case; the row is then already at least as current.
 */
export async function applySubscriptionState(
  db: BillingDb,
  userId: string,
  state: SubscriptionState,
  options: { authoritative?: boolean } = {},
): Promise<"applied" | "stale"> {
  const data = { ...state, ...legacyFlags(state) };
  const update = () =>
    db.subscription.updateMany({
      data,
      where: { AND: [{ userId }, mayReplace(state, options.authoritative ?? false)] },
    });

  if ((await update()).count > 0) return "applied";

  // Either there is no row yet, or the guard refused. Try to create it: the
  // unique userId makes exactly one concurrent creator succeed.
  try {
    await db.subscription.create({ data: { ...data, isLifetime: false, userId } });
    return "applied";
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  // A row exists. It may have been created a moment ago by a concurrent
  // handler with an older reading, so the guarded update gets one more go.
  return (await update()).count > 0 ? "applied" : "stale";
}

/** The user a Stripe customer id is stored on, or null. */
export async function findUserIdByCustomer(db: BillingDb, customerId: string): Promise<string | null> {
  const user = await db.user.findUnique({ select: { id: true }, where: { stripeId: customerId } });
  return user?.id ?? null;
}

/**
 * Records `customerId` as the user's Stripe customer, if they have none.
 *
 * - "linked" / "already": the user now has exactly this customer.
 * - "conflict": the user has a different customer, or this customer belongs
 *   to another user. Nothing was changed.
 */
export async function linkCustomerToUser(
  db: BillingDb,
  userId: string,
  customerId: string,
): Promise<"linked" | "already" | "conflict"> {
  try {
    const result = await db.user.updateMany({
      data: { stripeId: customerId },
      where: { id: userId, stripeId: null },
    });
    if (result.count > 0) return "linked";
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return "conflict";
  }
  const user = await db.user.findUnique({ select: { stripeId: true }, where: { id: userId } });
  return user?.stripeId === customerId ? "already" : "conflict";
}

const metadataUserId = (metadata: Stripe.Metadata | null | undefined): string | null => {
  const value = metadata?.userId;
  return typeof value === "string" && value.length > 0 ? value : null;
};

/**
 * The user a Stripe subscription belongs to.
 *
 * 1. The user the customer id is stored on (set when checkout starts).
 * 2. `metadata.userId`, which only this server writes: on the subscription,
 *    from the caller (`hintUserId`, a checkout session's reference), or on
 *    the customer.
 *
 * Never the email address: a Stripe customer's email is whatever was typed
 * at checkout and proves nothing about who owns an account here.
 */
export async function resolveUserForSubscription(
  db: BillingDb,
  stripe: Stripe,
  subscription: Stripe.Subscription,
  hintUserId: string | null = null,
): Promise<string | null> {
  const customerId = stripeId(subscription.customer);
  if (!customerId) return null;

  const byCustomer = await findUserIdByCustomer(db, customerId);
  if (byCustomer) return byCustomer;

  let candidate = metadataUserId(subscription.metadata) ?? hintUserId;
  if (!candidate) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      candidate = customer.deleted ? null : metadataUserId(customer.metadata);
    } catch (error) {
      if (!isStripeResourceMissing(error)) throw error;
    }
  }
  if (!candidate) return null;

  const user = await db.user.findUnique({ select: { id: true }, where: { id: candidate } });
  if (!user) return null;

  // Remember the customer for next time, but only for a subscription that
  // is still running: the customer of a finished one may have been deleted.
  if (!isTerminalStatus(subscription.status)) {
    const link = await linkCustomerToUser(db, user.id, customerId);
    if (link === "conflict") {
      reportBillingError("Stripe subscription names a user who has a different Stripe customer", {
        customerId,
        subscriptionId: subscription.id,
        userId: user.id,
      });
    }
  }
  return user.id;
}

export type SubscriptionSyncResult =
  | { outcome: "applied" | "stale"; state: SubscriptionState; userId: string }
  /** Stripe has no such subscription (deleted test data, wrong account). */
  | { outcome: "subscription_missing" }
  /** The subscription's customer is not a user of this app. */
  | { customerId: string | null; outcome: "unknown_customer" };

/**
 * Reads one subscription from Stripe and stores its current state. Stripe
 * errors other than "no such subscription" propagate (the caller retries).
 */
export async function syncSubscriptionById(
  db: BillingDb,
  stripe: Stripe,
  subscriptionId: string,
  hintUserId: string | null = null,
): Promise<SubscriptionSyncResult> {
  const requestedAt = new Date();
  let subscription: Stripe.Response<Stripe.Subscription>;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    if (isStripeResourceMissing(error)) return { outcome: "subscription_missing" };
    throw error;
  }

  const userId = await resolveUserForSubscription(db, stripe, subscription, hintUserId);
  if (!userId) {
    return { customerId: stripeId(subscription.customer), outcome: "unknown_customer" };
  }

  const state = subscriptionStateFromStripe(subscription, stripeResponseTime(subscription, requestedAt));
  const outcome = await applySubscriptionState(db, userId, state);
  if (outcome === "stale") {
    logger.info("Stripe subscription reading not stored: the row is newer or belongs to a live subscription", {
      subscriptionId,
      userId,
    });
  }
  return { outcome, state, userId };
}

export type UserSyncResult =
  | { outcome: "applied" | "stale"; state: SubscriptionState }
  | { outcome: "no_customer" | "no_subscription" };

/** Most subscriptions looked at when re-deriving a customer's state. */
const SUBSCRIPTIONS_PER_CUSTOMER = 20;

/**
 * Re-derives a user's subscription row from everything Stripe has for their
 * customer: the live subscription if there is one, else the most recent.
 * Repairs the row after a missed or failed webhook.
 */
export async function syncUserFromStripe(
  db: BillingDb,
  stripe: Stripe,
  userId: string,
): Promise<UserSyncResult> {
  const user = await db.user.findUnique({ select: { stripeId: true }, where: { id: userId } });
  if (!user?.stripeId) return { outcome: "no_customer" };

  const requestedAt = new Date();
  let list: Stripe.Response<Stripe.ApiList<Stripe.Subscription>>;
  try {
    list = await stripe.subscriptions.list({
      customer: user.stripeId,
      limit: SUBSCRIPTIONS_PER_CUSTOMER,
      status: "all",
    });
  } catch (error) {
    // The stored customer no longer exists at Stripe.
    if (isStripeResourceMissing(error)) return { outcome: "no_subscription" };
    throw error;
  }

  const primary = pickPrimarySubscription(list.data);
  if (!primary) return { outcome: "no_subscription" };

  const live = list.data.filter((sub) => !isTerminalStatus(sub.status));
  if (live.length > 1) {
    reportBillingError("Customer has more than one live Stripe subscription", {
      customerId: user.stripeId,
      subscriptionIds: live.map((sub) => sub.id),
      userId,
    });
  }

  const state = subscriptionStateFromStripe(primary, stripeResponseTime(list, requestedAt));
  const outcome = await applySubscriptionState(db, userId, state, { authoritative: true });
  return { outcome, state };
}

/**
 * The customer was deleted at Stripe (which also cancels its subscriptions):
 * forget the id and end any subscription row that hangs off it. Idempotent.
 */
export async function forgetDeletedCustomer(
  db: BillingDb,
  customerId: string,
  deletedAt: Date,
): Promise<{ subscriptionsEnded: number; usersUnlinked: number }> {
  const ended = await db.subscription.updateMany({
    data: {
      cancelAt: null,
      cancelAtPeriodEnd: false,
      cancellationReason: "customer_deleted",
      endedAt: deletedAt,
      status: "canceled",
      stripeSyncedAt: deletedAt,
      ...legacyFlags({ cancelAtPeriodEnd: false, currentPeriodEnd: null, status: "canceled" }),
    },
    where: { status: { notIn: [...TERMINAL_STATUSES] }, stripeCustomerId: customerId },
  });
  const unlinked = await db.user.updateMany({
    data: { stripeId: null },
    where: { stripeId: customerId },
  });
  return { subscriptionsEnded: ended.count, usersUnlinked: unlinked.count };
}
