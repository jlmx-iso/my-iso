import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import { logger } from "~/_utils";
import { isUniqueViolation } from "~/server/_db/errors";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";

import { isSubscriptionStatus, isTerminalStatus, TERMINAL_STATUSES } from "./entitlements";
import { reportBillingError } from "./report";
import { isStripeResourceMissing, stripeResponseTime } from "./stripe";
import {
  pastDueAnchor as pastDueAnchorOf,
  pickPrimarySubscription,
  stripeId,
  SUBSCRIPTION_EXPAND,
  SUBSCRIPTION_LIST_EXPAND,
  subscriptionStateFromStripe,
  type DisputeStanding,
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

type Where = Prisma.SubscriptionWhereInput;

/**
 * May a reading of the SAME subscription, taken at `syncedAt` on Stripe's
 * clock, replace the stored one?
 *
 * - Yes when the stored reading is strictly older.
 * - Stripe's clock (the response's `Date` header) has one-second resolution
 *   and a subscription object carries no "updated" marker of its own, so
 *   two readings can bear the same second without saying which is newer.
 *   A reading from the same second is accepted only when it says the same
 *   as the stored one (it is then a harmless rewrite). When it says
 *   something else the write is refused as a TIE, and the caller reads the
 *   subscription again once that second has passed (see storeReading):
 *   the new reading is strictly newer than both and settles it.
 *
 * So `stripeSyncedAt` never moves backwards, and neither `lte` (an older
 * reading from the same second overwrites a newer one) nor a bare `lt` (a
 * genuine change within one second is dropped) is relied on.
 */
function notOlderThanStored(state: SubscriptionState): Where {
  return {
    OR: [
      { stripeSyncedAt: null },
      { stripeSyncedAt: { lt: state.stripeSyncedAt } },
      {
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        currentPeriodEnd: state.currentPeriodEnd,
        latestInvoiceId: state.latestInvoiceId,
        status: state.status,
        stripeSyncedAt: state.stripeSyncedAt,
      },
    ],
  };
}

/** Dispute and refund markers belong to one subscription's payments. */
const NO_PAYMENT_MARKERS = {
  disputeId: null,
  disputeInvoiceId: null,
  disputeStatus: null,
  refundedInvoiceId: null,
} as const;

type WriteVariant = { data: Prisma.SubscriptionUpdateManyMutationInput; where: Where };

/**
 * The conditional updates that may store `state`, in the order to try them.
 * Each is ONE statement, so each is atomic on D1; the first that changes a
 * row wins.
 *
 * - Same subscription (or a row that never had one): when the reading is
 *   not older than the stored one (notOlderThanStored). This is what makes
 *   event order irrelevant: a late `subscription.updated` handled after
 *   `deleted` reads the same (cancelled) subscription from Stripe, and a
 *   slow handler holding an older reading loses to a faster one.
 * - A different subscription of the same user: only for an `authoritative`
 *   caller, one that chose this subscription from the customer's complete
 *   list (syncUserFromStripe), and only when that reading is not older than
 *   the stored one. A reading of a single subscription never replaces
 *   another subscription's row: the caller reconciles through the list
 *   instead (see syncSubscriptionById). Dispute and refund markers of the
 *   replaced subscription are dropped.
 *
 * `pastDueSince`: kept when the row is already past due for the same
 * subscription, set to `pastDueAnchor` when the subscription is past due
 * for the first time, cleared for every other status.
 */
function writeVariants(
  state: SubscriptionState,
  pastDueAnchor: Date,
  authoritative: boolean,
): WriteVariant[] {
  const row = { ...state, ...legacyFlags(state) };
  const sameSubscription: Where = {
    AND: [
      { OR: [{ subscriptionId: null }, { subscriptionId: state.subscriptionId }] },
      notOlderThanStored(state),
    ],
  };
  const otherSubscription: Where = {
    AND: [
      { subscriptionId: { not: state.subscriptionId } },
      { OR: [{ stripeSyncedAt: null }, { stripeSyncedAt: { lte: state.stripeSyncedAt } }] },
    ],
  };
  const replaceOther = (pastDueSince: Date | null): WriteVariant[] =>
    authoritative
      ? [{ data: { ...row, ...NO_PAYMENT_MARKERS, pastDueSince }, where: otherSubscription }]
      : [];

  if (state.status !== "past_due") {
    return [{ data: { ...row, pastDueSince: null }, where: sameSubscription }, ...replaceOther(null)];
  }
  return [
    {
      data: row,
      where: {
        AND: [
          sameSubscription,
          { pastDueSince: { not: null }, status: "past_due", subscriptionId: state.subscriptionId },
        ],
      },
    },
    { data: { ...row, pastDueSince: pastDueAnchor }, where: sameSubscription },
    ...replaceOther(pastDueAnchor),
  ];
}

export type ApplyOutcome =
  | "applied"
  /** The row holds a newer reading of this subscription. */
  | "stale"
  /**
   * The row holds a different reading of this subscription from the same
   * second: read the subscription again and retry.
   */
  | "tie"
  /** The row belongs to another subscription of the user. */
  | "other_subscription";

/**
 * Stores `state` as the user's subscription unless the row already holds
 * something that must not be replaced (see writeVariants); the result then
 * says what.
 *
 * `pastDueAnchor` is when a `past_due` subscription became past due, used
 * only if the row does not know yet (see pastDueAnchor in
 * subscriptionState.ts); it defaults to the time of the reading.
 */
export async function applySubscriptionState(
  db: BillingDb,
  userId: string,
  state: SubscriptionState,
  options: { authoritative?: boolean; pastDueAnchor?: Date } = {},
): Promise<ApplyOutcome> {
  if (!isSubscriptionStatus(state.status)) {
    // Stored verbatim and treated as "no access, manage in the portal"
    // (entitlements.ts); someone has to teach this code the new status.
    reportBillingError("Stripe subscription has a status this app does not know", {
      status: state.status,
      subscriptionId: state.subscriptionId,
      userId,
    });
  }

  const pastDueAnchor = options.pastDueAnchor ?? state.stripeSyncedAt;
  const variants = writeVariants(state, pastDueAnchor, options.authoritative ?? false);
  const update = async (): Promise<boolean> => {
    for (const { data, where } of variants) {
      const result = await db.subscription.updateMany({ data, where: { AND: [{ userId }, where] } });
      if (result.count > 0) return true;
    }
    return false;
  };

  if (await update()) return "applied";

  // Either there is no row yet, or the guards refused. Try to create it: the
  // unique userId makes exactly one concurrent creator succeed.
  try {
    await db.subscription.create({
      data: {
        ...state,
        ...legacyFlags(state),
        isLifetime: false,
        pastDueSince: state.status === "past_due" ? pastDueAnchor : null,
        userId,
      },
    });
    return "applied";
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  // A row exists. It may have been created a moment ago by a concurrent
  // handler with an older reading, so the guarded updates get one more go.
  if (await update()) return "applied";

  const stored = await db.subscription.findUnique({
    select: { stripeSyncedAt: true, subscriptionId: true },
    where: { userId },
  });
  if (stored?.subscriptionId && stored.subscriptionId !== state.subscriptionId) return "other_subscription";
  return stored?.stripeSyncedAt?.getTime() === state.stripeSyncedAt.getTime() ? "tie" : "stale";
}

/**
 * Records what a dispute on a payment of `subscriptionId` currently means
 * (derived from the dispute as just read from Stripe, so it can be repeated
 * and applied in any order). Returns false when no row tracks that
 * subscription.
 *
 * An open dispute is not displaced by the loss of another one, and a
 * cleared dispute only clears its own marker.
 */
export async function recordDispute(
  db: BillingDb,
  subscriptionId: string,
  dispute: { id: string; invoiceId: string; standing: DisputeStanding },
): Promise<boolean> {
  if (dispute.standing === "cleared") {
    await db.subscription.updateMany({
      data: { disputeId: null, disputeInvoiceId: null, disputeStatus: null },
      where: { disputeId: dispute.id, subscriptionId },
    });
    return (await db.subscription.count({ where: { subscriptionId } })) > 0;
  }

  const anotherIsOpen: Where = { disputeId: { not: dispute.id }, disputeStatus: "open" };
  const result = await db.subscription.updateMany({
    data: {
      disputeId: dispute.id,
      disputeInvoiceId: dispute.invoiceId,
      disputeStatus: dispute.standing,
    },
    where:
      dispute.standing === "open"
        ? { subscriptionId }
        : {
            // NOT anotherIsOpen, with the NULL cases spelled out.
            OR: [{ disputeId: null }, { disputeId: dispute.id }, { disputeStatus: null }, { disputeStatus: { not: "open" } }],
            subscriptionId,
          },
  });
  if (result.count > 0) return true;
  return (await db.subscription.count({ where: { AND: [{ subscriptionId }, anotherIsOpen] } })) > 0;
}

/**
 * Records whether the payment of `invoiceId` is (still) refunded in full,
 * as just read from Stripe. Returns false when no row tracks the
 * subscription.
 */
export async function recordRefund(
  db: BillingDb,
  subscriptionId: string,
  refund: { fullyRefunded: boolean; invoiceId: string },
): Promise<boolean> {
  if (refund.fullyRefunded) {
    const result = await db.subscription.updateMany({
      data: { refundedInvoiceId: refund.invoiceId },
      where: { subscriptionId },
    });
    return result.count > 0;
  }
  // A partial refund, or a refund that failed and was reversed.
  await db.subscription.updateMany({
    data: { refundedInvoiceId: null },
    where: { refundedInvoiceId: refund.invoiceId, subscriptionId },
  });
  return (await db.subscription.count({ where: { subscriptionId } })) > 0;
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

/** How the sync functions wait; replaceable in tests. */
export type SyncOptions = {
  /** The local clock in milliseconds. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** Readings of one subscription taken to get past a same-second tie. */
const MAX_READINGS = 3;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Two readings from the same second disagree and re-reading did not settle it. */
export class UnorderedReadingsError extends Error {
  constructor(what: string) {
    super(`Could not order two readings of ${what} taken in the same second`);
    this.name = "UnorderedReadingsError";
  }
}

/**
 * Reads from Stripe and stores, again while the result is a same-second
 * tie (see notOlderThanStored): each further reading is taken after the
 * tied second has passed, so it is strictly newer and wins. Throws
 * UnorderedReadingsError if that does not settle it (the webhook then
 * answers 500 and Stripe redelivers).
 */
async function storeReading<T extends { outcome: ApplyOutcome; state: SubscriptionState }, E>(
  what: string,
  readAndApply: () => Promise<T | E>,
  isReading: (result: T | E) => result is T,
  options: SyncOptions,
): Promise<T | E> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  for (let reading = 1; ; reading += 1) {
    const result = await readAndApply();
    if (!isReading(result) || result.outcome !== "tie") return result;
    if (reading >= MAX_READINGS) throw new UnorderedReadingsError(what);
    // Until the tied second is over on Stripe's clock (ours may differ a
    // little, hence the margin), but never long.
    const untilNextSecond = result.state.stripeSyncedAt.getTime() + 1000 - now();
    await sleep(Math.min(1500, Math.max(100, untilNextSecond + 100)));
  }
}

export type SubscriptionSyncResult =
  | { outcome: "applied" | "stale"; state: SubscriptionState; userId: string }
  /** Stripe has no such subscription (deleted test data, wrong account). */
  | { outcome: "subscription_missing" }
  /** The subscription's customer is not a user of this app. */
  | { customerId: string | null; outcome: "unknown_customer" };

type SingleReading = { outcome: ApplyOutcome; state: SubscriptionState; userId: string };

/**
 * Reads one subscription from Stripe and stores its current state. Stripe
 * errors other than "no such subscription" propagate (the caller retries).
 *
 * When the user's row belongs to a DIFFERENT subscription, a single
 * reading cannot say which of the two should be shown: the row is then
 * re-derived from the customer's complete list (syncUserFromStripe), which
 * applies the precedence rules to current data. The returned `state` is
 * what this subscription read as; "stale" means the row shows another one.
 */
export async function syncSubscriptionById(
  db: BillingDb,
  stripe: Stripe,
  subscriptionId: string,
  hintUserId: string | null = null,
  options: SyncOptions = {},
): Promise<SubscriptionSyncResult> {
  type Early = Exclude<SubscriptionSyncResult, { state: SubscriptionState }>;
  const isReading = (result: SingleReading | Early): result is SingleReading => "state" in result;

  const result = await storeReading<SingleReading, Early>(
    `subscription ${subscriptionId}`,
    async () => {
      const requestedAt = new Date();
      let subscription: Stripe.Response<Stripe.Subscription>;
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: SUBSCRIPTION_EXPAND });
      } catch (error) {
        if (isStripeResourceMissing(error)) return { outcome: "subscription_missing" } satisfies Early;
        throw error;
      }

      const userId = await resolveUserForSubscription(db, stripe, subscription, hintUserId);
      if (!userId) {
        return { customerId: stripeId(subscription.customer), outcome: "unknown_customer" } satisfies Early;
      }

      const state = subscriptionStateFromStripe(subscription, stripeResponseTime(subscription, requestedAt));
      const outcome = await applySubscriptionState(db, userId, state, {
        pastDueAnchor: pastDueAnchorOf(subscription, state.stripeSyncedAt),
      });
      return { outcome, state, userId };
    },
    isReading,
    options,
  );
  if (!isReading(result)) return result;

  const { state, userId } = result;
  if (result.outcome === "applied" || result.outcome === "stale") {
    if (result.outcome === "stale") {
      logger.info("Stripe subscription reading not stored: the row holds a newer one", { subscriptionId, userId });
    }
    return { outcome: result.outcome, state, userId };
  }

  // other_subscription: let the customer's complete list decide.
  const user = await db.user.findUnique({ select: { stripeId: true }, where: { id: userId } });
  if (user?.stripeId && user.stripeId !== state.stripeCustomerId) {
    // Already reported by resolveUserForSubscription when it matters.
    logger.warn("Stripe subscription of a customer other than the user's stored one: row left as it is", {
      subscriptionId,
      userId,
    });
    return { outcome: "stale", state, userId };
  }
  const reconciled = await syncUserFromStripe(db, stripe, userId, options, state.stripeCustomerId);
  const shown =
    (reconciled.outcome === "applied" || reconciled.outcome === "stale") &&
    reconciled.state.subscriptionId === subscriptionId;
  return { outcome: shown ? "applied" : "stale", state, userId };
}

export type UserSyncResult =
  | {
      /** The customer has a subscription that has not ended (any of them). */
      hasLiveSubscription: boolean;
      outcome: "applied" | "stale";
      state: SubscriptionState;
    }
  | { outcome: "no_customer" | "no_subscription" };

/** Page size, and the most pages read, when listing a customer's subscriptions. */
const SUBSCRIPTIONS_PAGE_SIZE = 100;
const MAX_SUBSCRIPTION_PAGES = 5;
/** Cancelled subscriptions looked at (newest first) when none is live. */
const CANCELED_SUBSCRIPTIONS_CONSIDERED = 10;

type CustomerSubscriptions = {
  canceled: Stripe.Subscription[];
  /** Everything that is not `canceled`, however old. */
  notCanceled: Stripe.Subscription[];
  syncedAt: Date;
};

/**
 * Everything needed to choose a customer's subscription, read so that a
 * long history cannot hide the one that matters:
 *
 * 1. ALL subscriptions that are not cancelled (Stripe's default listing),
 *    following `has_more` to the end. This is where a live subscription
 *    is, however many newer cancelled ones there are.
 * 2. The most recent cancelled ones. Only one with paid time left, or the
 *    most recent of all, can matter, and both are at the top.
 */
async function listCustomerSubscriptions(stripe: Stripe, customerId: string): Promise<CustomerSubscriptions> {
  const requestedAt = new Date();
  const notCanceled: Stripe.Subscription[] = [];
  let syncedAt: Date | null = null;
  let startingAfter: string | undefined;
  for (let page = 1; ; page += 1) {
    const list = await stripe.subscriptions.list({
      customer: customerId,
      expand: SUBSCRIPTION_LIST_EXPAND,
      limit: SUBSCRIPTIONS_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    syncedAt ??= stripeResponseTime(list, requestedAt);
    notCanceled.push(...list.data);
    startingAfter = list.data.at(-1)?.id;
    if (!list.has_more || !startingAfter) break;
    if (page >= MAX_SUBSCRIPTION_PAGES) {
      reportBillingError("Customer has more subscriptions than are read; the oldest were not considered", {
        customerId,
        read: notCanceled.length,
      });
      break;
    }
  }

  const canceled = await stripe.subscriptions.list({
    customer: customerId,
    expand: SUBSCRIPTION_LIST_EXPAND,
    limit: CANCELED_SUBSCRIPTIONS_CONSIDERED,
    status: "canceled",
  });
  return { canceled: canceled.data, notCanceled, syncedAt: syncedAt ?? requestedAt };
}

/**
 * Re-derives a user's subscription row from everything Stripe has for their
 * customer: the subscription with precedence (pickPrimarySubscription).
 * Repairs the row after a missed or failed webhook. `customerId` overrides
 * the stored customer (for a user who has none stored yet).
 */
export async function syncUserFromStripe(
  db: BillingDb,
  stripe: Stripe,
  userId: string,
  options: SyncOptions = {},
  customerId?: string,
): Promise<UserSyncResult> {
  const customer =
    customerId ??
    (await db.user.findUnique({ select: { stripeId: true }, where: { id: userId } }))?.stripeId ??
    null;
  if (!customer) return { outcome: "no_customer" };

  type Reading = { hasLiveSubscription: boolean; outcome: ApplyOutcome; state: SubscriptionState };
  type Early = { outcome: "no_subscription" };
  const isReading = (result: Reading | Early): result is Reading => "state" in result;

  const result = await storeReading<Reading, Early>(
    `the subscriptions of customer ${customer}`,
    async () => {
      let listed: CustomerSubscriptions;
      try {
        listed = await listCustomerSubscriptions(stripe, customer);
      } catch (error) {
        // The stored customer no longer exists at Stripe.
        if (isStripeResourceMissing(error)) return { outcome: "no_subscription" } satisfies Early;
        throw error;
      }

      const { syncedAt } = listed;
      const primary = pickPrimarySubscription([...listed.notCanceled, ...listed.canceled], syncedAt);
      if (!primary) return { outcome: "no_subscription" } satisfies Early;

      const live = listed.notCanceled.filter((sub) => !isTerminalStatus(sub.status));
      if (live.length > 1) {
        reportBillingError("Customer has more than one live Stripe subscription", {
          customerId: customer,
          subscriptionIds: live.map((sub) => sub.id),
          userId,
        });
      }

      const state = subscriptionStateFromStripe(primary, syncedAt);
      const outcome = await applySubscriptionState(db, userId, state, {
        authoritative: true,
        pastDueAnchor: pastDueAnchorOf(primary, syncedAt),
      });
      return { hasLiveSubscription: live.length > 0, outcome, state } satisfies Reading;
    },
    isReading,
    options,
  );
  if (!isReading(result)) return result;
  return {
    hasLiveSubscription: result.hasLiveSubscription,
    // An authoritative write is only ever refused for being older.
    outcome: result.outcome === "applied" ? "applied" : "stale",
    state: result.state,
  };
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
      paidThroughAt: null,
      pastDueSince: null,
      status: "canceled",
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
