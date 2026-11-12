import { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import { logger } from "~/_utils";
import { isUniqueViolation } from "~/server/_db/errors";
import { type ExtendedPrismaClient, INCLUDING_DELETED } from "~/server/_db/softDelete";

import { endBillingForClosedAccount, isClosedAccount } from "./accountClosure";
import { isSubscriptionStatus, isTerminalStatus, TERMINAL_STATUSES } from "./entitlements";
import { LeaseLostError, withLease, type LeaseDb, type LeaseHandle, type LeaseOptions } from "./lease";
import {
  readPaymentStanding,
  type KnownDispute,
  type PaymentStanding,
} from "./paymentStanding";
import { reportBillingError } from "./report";
import { isStripeResourceMissing, stripeResponseTime } from "./stripe";
import {
  pastDueAnchor as pastDueAnchorOf,
  pickPrimarySubscription,
  stripeId,
  SUBSCRIPTION_EXPAND,
  SUBSCRIPTION_LIST_EXPAND,
  subscriptionStateFromStripe,
  type SubscriptionState,
} from "./subscriptionState";

/**
 * Reading and writing the stored billing state.
 *
 * D1 has no interactive transactions, so every write here is a single
 * conditional statement (or an insert guarded by the unique userId), and
 * every function can be repeated or run concurrently with itself.
 *
 * On top of that, every read-from-Stripe-then-write sequence runs under a
 * lease per Stripe CUSTOMER (./lease.ts), so two readings for one customer
 * are taken and stored one after the other and cannot interleave. The
 * conditional writes remain as the second line of defence, for a holder
 * that outlives its lease.
 */

export type BillingDb = Pick<ExtendedPrismaClient, "subscription" | "subscriptionDispute" | "user"> & LeaseDb;

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
 *   as the stored one in EVERY field read from Stripe (it is then a
 *   harmless rewrite); the comparison is the whole state, not a selection
 *   of fields, so no difference (a cancellation date, say) slips through. When it says
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
      { ...state },
    ],
  };
}

/** Dispute and refund markers belong to one subscription's payments. */
const NO_PAYMENT_MARKERS = {
  disputeId: null,
  disputeInvoiceId: null,
  disputeStatus: null,
  refundedInvoiceId: null,
  // The standing of the subscription the row now shows has not been derived.
  standingSyncedAt: null,
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
 *   list (syncUserFromStripe), and only when that reading is strictly newer
 *   than the stored one (a reading from the same second is a tie, settled
 *   by reading again). A reading of a single subscription never replaces
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
  standingFollows: boolean,
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
      { OR: [{ stripeSyncedAt: null }, { stripeSyncedAt: { lt: state.stripeSyncedAt } }] },
    ],
  };
  const replaceOther = (pastDueSince: Date | null): WriteVariant[] =>
    authoritative
      ? [{ data: { ...row, ...NO_PAYMENT_MARKERS, pastDueSince }, where: otherSubscription }]
      : [];

  if (state.status !== "past_due") {
    return [
      ...keepingSettledIfUnchanged(state, standingFollows, { data: { ...row, pastDueSince: null }, where: sameSubscription }),
      ...replaceOther(null),
    ];
  }
  return [
    ...keepingSettledIfUnchanged(state, standingFollows, {
      data: row,
      where: {
        AND: [
          sameSubscription,
          { pastDueSince: { not: null }, status: "past_due", subscriptionId: state.subscriptionId },
        ],
      },
    }),
    ...keepingSettledIfUnchanged(state, standingFollows, { data: { ...row, pastDueSince: pastDueAnchor }, where: sameSubscription }),
    ...replaceOther(pastDueAnchor),
  ];
}

/**
 * A same-subscription write, split in two so that `standingSyncedAt` (the
 * row is settled: its payment standing was derived completely, see
 * writePaymentStanding) follows the state it was derived for:
 *
 * (When the caller is about to derive the standing itself, `standingFollows`,
 * the write always withdraws "settled" and the standing write restores it.)
 * For a write that is NOT followed by a derivation (subscription and
 * checkout events):
 *
 * 1. when the reading leaves `status`, `latestInvoiceId` and
 *    `paidThroughAt` as stored, the row is written as before and stays
 *    settled. This is every no-op delivery, and most real ones (a changed
 *    cancellation date, period or price does not change the standing);
 * 2. otherwise the same write also clears `standingSyncedAt`. Those three
 *    are what the standing is derived against (which invoice is the latest,
 *    whether it is paid, what the subscription's status makes of a refund
 *    or a loss), so a standing derived before they changed no longer
 *    vouches for the row. The dispute and refund markers themselves are
 *    left as they are; only "settled" is withdrawn, until a derivation has
 *    completed for the new state. If that derivation is cut off or fails,
 *    the re-sync's default scope and the lazy sync still select the row.
 */
function keepingSettledIfUnchanged(
  state: SubscriptionState,
  standingFollows: boolean,
  variant: WriteVariant,
): WriteVariant[] {
  const unsettling: WriteVariant = { data: { ...variant.data, standingSyncedAt: null }, where: variant.where };
  // The caller derives the standing next and settles the row with it: until
  // then it is not settled, changed or not (see applySubscriptionState).
  if (standingFollows) return [unsettling];
  const standingBasisUnchanged: Where = {
    latestInvoiceId: state.latestInvoiceId,
    paidThroughAt: state.paidThroughAt,
    status: state.status,
  };
  return [{ data: variant.data, where: { AND: [variant.where, standingBasisUnchanged] } }, unsettling];
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
  /**
   * The row belongs to another subscription of the user (and, for an
   * authoritative caller, holds a strictly newer reading).
   */
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
  options: {
    authoritative?: boolean;
    pastDueAnchor?: Date;
    /**
     * The caller derives the payment standing right after this write. The
     * write then always withdraws "settled" (`standingSyncedAt`), and the
     * standing write gives it back when it has completed: if the work stops
     * in between, the row does not pass for settled on an earlier
     * derivation.
     */
    standingFollows?: boolean;
  } = {},
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
  const variants = writeVariants(
    state,
    pastDueAnchor,
    options.authoritative ?? false,
    options.standingFollows ?? false,
  );
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
  const sameSecond = stored?.stripeSyncedAt?.getTime() === state.stripeSyncedAt.getTime();
  if (stored?.subscriptionId && stored.subscriptionId !== state.subscriptionId) {
    return options.authoritative && sameSecond ? "tie" : "other_subscription";
  }
  return sameSecond ? "tie" : "stale";
}

/**
 * Stores the payment standing of `subscriptionId` (./paymentStanding.ts) on
 * the row that tracks it, in ONE statement that also requires the caller
 * to still hold the customer's lease: a holder that ran past its lease
 * cannot put an older standing over the one its successor derived.
 *
 * - "recorded": stored. `standingSyncedAt` is set in the same statement
 *   when the derivation was complete, and cleared when it was not: it is
 *   what says the row is settled (rowNeedsFirstSync, the re-sync's default
 *   scope). It is deliberately NOT written with the subscription state
 *   (`stripeSyncedAt`, which orders readings): work that is cut off after
 *   the state write and before this one leaves a row that is visibly not
 *   settled and is picked up again, and an incomplete derivation keeps the
 *   row in scope until one completes.
 * - "not_tracked": the user's row shows another subscription (or there is
 *   no row).
 *
 * Throws LeaseLostError when the lease was taken over.
 */
export async function writePaymentStanding(
  db: BillingDb,
  lease: LeaseHandle,
  subscriptionId: string,
  standing: PaymentStanding,
): Promise<"recorded" | "not_tracked"> {
  const written = await db.$executeRaw(Prisma.sql`
    UPDATE "Subscription" SET
      "disputeId" = ${standing.disputeId},
      "disputeStatus" = ${standing.disputeStatus},
      "disputeInvoiceId" = ${standing.disputeInvoiceId},
      "refundedInvoiceId" = ${standing.refundedInvoiceId},
      "standingSyncedAt" = ${standing.incomplete ? null : new Date()}
    WHERE "subscriptionId" = ${subscriptionId} AND ${lease.heldCondition()}`);
  if (written > 0) return "recorded";
  if ((await db.subscription.count({ where: { subscriptionId } })) === 0) return "not_tracked";
  // The row is there, so it was the lease condition that failed.
  throw new LeaseLostError(lease.key);
}

/**
 * The user a Stripe customer id is stored on, or null. A deleted account
 * counts: its billing still has to be recorded and ended (./accountClosure).
 */
export async function findUserIdByCustomer(db: BillingDb, customerId: string): Promise<string | null> {
  const user = await db.user.findFirst({ select: { id: true }, where: { ...INCLUDING_DELETED, stripeId: customerId } });
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

  const user = await db.user.findFirst({
    select: { id: true, isDeleted: true },
    where: { ...INCLUDING_DELETED, id: candidate },
  });
  if (!user) return null;

  // Remember the customer for next time, but only for a subscription that
  // is still running (the customer of a finished one may have been
  // deleted), and never for a deleted account.
  if (!isTerminalStatus(subscription.status) && !user.isDeleted) {
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
  /**
   * The Stripe customer the subscription is on, when the caller knows it
   * (a webhook event names it). Identity only, never state: it selects the
   * lease, and a reading that turns out to be another customer's is taken
   * again under the right one.
   */
  customerId?: string | null;
  /** How the customer's lease is waited for; for tests. */
  lease?: Pick<LeaseOptions, "now" | "random" | "sleep">;
  /**
   * How long to wait for the customer's lease (default
   * SYNC_LEASE_WAIT_MS). A caller with a time budget of its own (the lazy
   * first sync) waits less: a busy lease means someone else is syncing.
   */
  leaseWaitMs?: number;
  /** Page size and page limit when listing a customer's subscriptions; for tests. */
  listing?: { maxPages: number; pageSize: number };
  /** The local clock in milliseconds. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Also derive the payment standing (disputes, refunds) of the stored
   * subscription from Stripe and store it, under the same lease.
   */
  standing?: boolean;
  /**
   * With `standing`: the payment intent a dispute or refund event is about,
   * whose charges are then read directly (see readPaymentStanding).
   */
  standingPaymentIntentId?: string | null;
};

/**
 * The per-customer lease: held for one read-and-store sequence (a handful
 * of Stripe calls), waited for by the next. A webhook that cannot get it in
 * time answers 409 and is redelivered, which costs less than waiting long:
 * 3.5 s is about seven attempts (see retryDelayMs in ./lease.ts).
 */
const SYNC_LEASE_SECONDS = 90;
export const SYNC_LEASE_WAIT_MS = 3500;

const customerLeaseKey = (customerId: string) => `customer:${customerId}`;

function withCustomerLease<T>(
  db: BillingDb,
  customerId: string,
  options: SyncOptions,
  work: (lease: LeaseHandle) => Promise<T>,
): Promise<T> {
  return withLease(
    db,
    customerLeaseKey(customerId),
    { ...options.lease, ttlSeconds: SYNC_LEASE_SECONDS, waitMs: options.leaseWaitMs ?? SYNC_LEASE_WAIT_MS },
    work,
  );
}

/** Readings of one subscription taken to get past a same-second tie. */
export const MAX_READINGS = 3;

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
  | {
      outcome: "applied" | "stale";
      /**
       * With `options.standing`: the standing derived and stored for this
       * subscription; null when it was not stored (the row shows another
       * subscription).
       */
      standing?: PaymentStanding | null;
      state: SubscriptionState;
      userId: string;
    }
  /** Stripe has no such subscription (deleted test data, wrong account). */
  | { outcome: "subscription_missing" }
  /** The subscription's customer is not a user of this app. */
  | { customerId: string | null; outcome: "unknown_customer" };

type SingleReading = { outcome: ApplyOutcome; state: SubscriptionState; userId: string };

/** The subscription is on a customer other than the one whose lease is held. */
type OtherCustomer = { customerId: string; outcome: "other_customer" };

/**
 * Unfinished disputes of one subscription read per derivation. More than
 * this is detected (see storePaymentStanding) and fails closed.
 */
export const KNOWN_DISPUTES_READ = 50;

const isKnownDisputeStatus = (status: string): status is KnownDispute["status"] =>
  ["open", "inquiry", "lost", "superseded", "cleared", "unexamined"].includes(status);

/**
 * Upserts one dispute into SubscriptionDispute, in ONE statement that also
 * requires the customer's lease to be held (a holder that outlived its
 * lease writes nothing). A dispute is never removed, and one that is
 * finished is not looked at again; "superseded" is not undone by the same
 * lost dispute being seen once more on a listing.
 */
async function rememberDispute(
  db: BillingDb,
  lease: LeaseHandle,
  subscriptionId: string,
  dispute: KnownDispute,
): Promise<void> {
  const now = new Date();
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "SubscriptionDispute" ("disputeId", "subscriptionId", "invoiceId", "status", "updatedAt")
    SELECT ${dispute.disputeId}, ${subscriptionId}, ${dispute.invoiceId}, ${dispute.status}, ${now}
    WHERE ${lease.heldCondition()}
    ON CONFLICT ("disputeId") DO UPDATE SET
      "status" = CASE
        WHEN "SubscriptionDispute"."status" = 'superseded' AND excluded."status" = 'lost' THEN 'superseded'
        ELSE excluded."status"
      END,
      "updatedAt" = excluded."updatedAt"`);
}

/** Derives the standing of `subscription` from Stripe and stores it; null when not stored. */
async function storePaymentStanding(
  db: BillingDb,
  stripe: Stripe,
  lease: LeaseHandle,
  subscription: Stripe.Subscription,
  paymentIntentId: string | null = null,
): Promise<PaymentStanding | null> {
  // Every dispute known for the subscription that is not finished. Read
  // under the lease, which is what serialises it with the writes below.
  // Those that can withhold access or still change (open, inquiry) are
  // read first, so that they are never the ones a limit cuts; then the lost
  // ones. One row more than the limit is asked for: if it is there, the set
  // was not read whole, and the derivation is told so (it fails closed).
  const knownOf = (statuses: string[], take: number) =>
    take <= 0
      ? Promise.resolve([])
      : db.subscriptionDispute.findMany({
          orderBy: [{ updatedAt: "desc" }, { disputeId: "asc" }],
          select: { disputeId: true, invoiceId: true, status: true },
          take,
          where: { status: { in: statuses }, subscriptionId: subscription.id },
        });
  const live = await knownOf(["open", "inquiry", "unexamined"], KNOWN_DISPUTES_READ + 1);
  const lost = await knownOf(["lost"], KNOWN_DISPUTES_READ + 1 - live.length);
  const rows = [...live, ...lost];
  const known = rows.slice(0, KNOWN_DISPUTES_READ).filter((row): row is KnownDispute => isKnownDisputeStatus(row.status));
  const storedRow = await db.subscription.findFirst({
    select: { refundedInvoiceId: true },
    where: { subscriptionId: subscription.id },
  });
  const reading = await readPaymentStanding(stripe, subscription, {
    known,
    knownTruncated: rows.length > KNOWN_DISPUTES_READ,
    paymentIntentId,
    storedRefundedInvoiceId: storedRow?.refundedInvoiceId ?? null,
  });
  if (!reading) return null;
  const { standing } = reading;
  // Remember every dispute this derivation knows of, as it is now. Each is
  // one statement that also requires the lease to be held still.
  for (const dispute of reading.disputes) await rememberDispute(db, lease, subscription.id, dispute);
  const written = await writePaymentStanding(db, lease, subscription.id, standing);
  if (written !== "recorded") return null;
  if (standing.incomplete) {
    // Never silently: the row is named, here and in the re-sync's list.
    const row = await db.subscription.findFirst({ select: { id: true }, where: { subscriptionId: subscription.id } });
    reportBillingError("Payment standing derived from an incomplete history: the row needs review", {
      accessWithheld: standing.disputeStatus !== null,
      subscriptionId: subscription.id,
      subscriptionRowId: row?.id ?? null,
    });
  }
  return standing;
}

/** syncSubscriptionById, for a caller that holds the lease of `leasedCustomerId`. */
async function syncSubscriptionLocked(
  db: BillingDb,
  stripe: Stripe,
  lease: LeaseHandle,
  leasedCustomerId: string,
  subscriptionId: string,
  hintUserId: string | null,
  options: SyncOptions,
): Promise<SubscriptionSyncResult | OtherCustomer> {
  type Early = Exclude<SubscriptionSyncResult, { state: SubscriptionState }> | OtherCustomer;
  const isReading = (result: SingleReading | Early): result is SingleReading => "state" in result;
  const read: { subscription: Stripe.Subscription | null } = { subscription: null };

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
      const customerId = stripeId(subscription.customer);
      if (customerId && customerId !== leasedCustomerId) {
        return { customerId, outcome: "other_customer" } satisfies Early;
      }

      const userId = await resolveUserForSubscription(db, stripe, subscription, hintUserId);
      if (!userId) {
        return { customerId, outcome: "unknown_customer" } satisfies Early;
      }

      const state = subscriptionStateFromStripe(subscription, stripeResponseTime(subscription, requestedAt));
      const outcome = await applySubscriptionState(db, userId, state, {
        pastDueAnchor: pastDueAnchorOf(subscription, state.stripeSyncedAt),
        standingFollows: options.standing === true,
      });
      read.subscription = subscription;
      return { outcome, state, userId };
    },
    isReading,
    options,
  );
  if (!isReading(result)) return result;

  // A deleted account: its state is stored above (the row is the billing
  // record), and nothing may be charged any more.
  if (read.subscription && !isTerminalStatus(read.subscription.status) && (await isClosedAccount(db, result.userId))) {
    await endBillingForClosedAccount(stripe, subscriptionId);
  }

  const { state, userId } = result;
  let outcome: "applied" | "stale";
  if (result.outcome === "applied" || result.outcome === "stale") {
    if (result.outcome === "stale") {
      logger.info("Stripe subscription reading not stored: the row holds a newer one", { subscriptionId, userId });
    }
    outcome = result.outcome;
  } else {
    // other_subscription: let the customer's complete list decide.
    const user = await db.user.findFirst({ select: { stripeId: true }, where: { ...INCLUDING_DELETED, id: userId } });
    if (user?.stripeId && user.stripeId !== state.stripeCustomerId) {
      // Already reported by resolveUserForSubscription when it matters.
      logger.warn("Stripe subscription of a customer other than the user's stored one: row left as it is", {
        subscriptionId,
        userId,
      });
      return { outcome: "stale", state, userId };
    }
    // With the standing of whichever subscription the list makes primary
    // (the row's markers are cleared when it switches): derived there, for
    // that subscription, with the event's payment only if it is this one.
    const reconciled = await syncUserLocked(db, stripe, lease, userId, state.stripeCustomerId, options, subscriptionId);
    const shown =
      (reconciled.outcome === "applied" || reconciled.outcome === "stale") &&
      reconciled.state.subscriptionId === subscriptionId;
    if (!options.standing) return { outcome: shown ? "applied" : "stale", state, userId };
    // What is returned is THIS subscription's standing: the primary's when
    // this is the primary, none when the row shows another.
    const standing = shown && "standing" in reconciled ? (reconciled.standing ?? null) : null;
    return { outcome: shown ? "applied" : "stale", standing, state, userId };
  }

  if (!options.standing || !read.subscription) return { outcome, state, userId };
  const standing = await storePaymentStanding(
    db,
    stripe,
    lease,
    read.subscription,
    options.standingPaymentIntentId ?? null,
  );
  return { outcome, standing, state, userId };
}

/**
 * Reads one subscription from Stripe and stores its current state, under
 * the lease of its customer. Stripe errors other than "no such
 * subscription" propagate (the caller retries), as does LeaseBusyError.
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
  // Whose lease: the caller's word, else the row that tracks the
  // subscription, else Stripe (identity only; the state is read under the
  // lease).
  let customerId =
    options.customerId ??
    (await db.subscription.findFirst({ select: { stripeCustomerId: true }, where: { subscriptionId } }))
      ?.stripeCustomerId ??
    null;
  if (!customerId) {
    try {
      customerId = stripeId((await stripe.subscriptions.retrieve(subscriptionId)).customer);
    } catch (error) {
      if (isStripeResourceMissing(error)) return { outcome: "subscription_missing" };
      throw error;
    }
    if (!customerId) return { customerId: null, outcome: "unknown_customer" };
  }

  // A subscription never changes customer, so a second round (the hint or
  // the legacy row named the wrong one) is the last.
  for (let round = 0; round < 2; round += 1) {
    const leased: string = customerId;
    const result: SubscriptionSyncResult | OtherCustomer = await withCustomerLease(db, leased, options, (lease) =>
      syncSubscriptionLocked(db, stripe, lease, leased, subscriptionId, hintUserId, options),
    );
    if (result.outcome !== "other_customer") return result;
    customerId = result.customerId;
  }
  throw new Error(`Stripe subscription ${subscriptionId} could not be read under its customer's lease`);
}

export type UserSyncResult =
  | {
      /** The customer has a subscription that has not ended (any of them). */
      hasLiveSubscription: boolean;
      outcome: "applied" | "stale";
      /** With `options.standing`: as on SubscriptionSyncResult. */
      standing?: PaymentStanding | null;
      state: SubscriptionState;
    }
  | { outcome: "no_customer" | "no_subscription" }
  /**
   * The customer has more subscriptions than are read. Nothing was
   * concluded and nothing written: neither "this one is the primary" nor
   * "there is none" can be said from part of the list.
   */
  | { outcome: "listing_truncated" };

/** Page size, and the most pages read, when listing a customer's subscriptions. */
const SUBSCRIPTIONS_PAGE_SIZE = 100;
export const MAX_SUBSCRIPTION_PAGES = 5;

type CustomerSubscriptions = {
  canceled: Stripe.Subscription[];
  /** Everything that is not `canceled`, however old. */
  notCanceled: Stripe.Subscription[];
  syncedAt: Date;
  /** A listing still had more when the page limit was reached. */
  truncated: boolean;
};

/**
 * Everything needed to choose a customer's subscription, read to the end
 * so that a long history cannot hide the one that matters:
 *
 * 1. ALL subscriptions that are not cancelled (Stripe's default listing).
 *    This is where a live subscription is, however many newer cancelled
 *    ones there are.
 * 2. ALL cancelled ones: one with paid time left can be older than any
 *    number of later, finished ones.
 *
 * Both follow `has_more`, up to `maxPages` pages each. Past that the result
 * is marked `truncated`, and the caller must not decide anything from it.
 */
async function listCustomerSubscriptions(
  stripe: Stripe,
  customerId: string,
  limits: { maxPages: number; pageSize: number },
): Promise<CustomerSubscriptions> {
  const requestedAt = new Date();
  let syncedAt: Date | null = null;
  let truncated = false;

  const listAll = async (status?: "canceled"): Promise<Stripe.Subscription[]> => {
    const all: Stripe.Subscription[] = [];
    let startingAfter: string | undefined;
    for (let page = 1; ; page += 1) {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        expand: SUBSCRIPTION_LIST_EXPAND,
        limit: limits.pageSize,
        ...(status ? { status } : {}),
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      syncedAt ??= stripeResponseTime(list, requestedAt);
      all.push(...list.data);
      startingAfter = list.data.at(-1)?.id;
      if (!list.has_more || !startingAfter) return all;
      if (page >= limits.maxPages) {
        truncated = true;
        return all;
      }
    }
  };

  const notCanceled = await listAll();
  const canceled = truncated ? [] : await listAll("canceled");
  return { canceled, notCanceled, syncedAt: syncedAt ?? requestedAt, truncated };
}

/** syncUserFromStripe, for a caller that holds the lease of `customer`. */
async function syncUserLocked(
  db: BillingDb,
  stripe: Stripe,
  lease: LeaseHandle,
  userId: string,
  customer: string,
  options: SyncOptions,
  /** The subscription `options.standingPaymentIntentId` belongs to, when there is one. */
  eventSubscriptionId?: string,
): Promise<UserSyncResult> {
  type Reading = {
    hasLiveSubscription: boolean;
    outcome: ApplyOutcome;
    primary: Stripe.Subscription;
    state: SubscriptionState;
  };
  type Early = { outcome: "no_subscription" | "listing_truncated" };
  const isReading = (result: Reading | Early): result is Reading => "state" in result;
  const limits = options.listing ?? { maxPages: MAX_SUBSCRIPTION_PAGES, pageSize: SUBSCRIPTIONS_PAGE_SIZE };

  const result = await storeReading<Reading, Early>(
    `the subscriptions of customer ${customer}`,
    async () => {
      let listed: CustomerSubscriptions;
      try {
        listed = await listCustomerSubscriptions(stripe, customer, limits);
      } catch (error) {
        // The stored customer no longer exists at Stripe.
        if (isStripeResourceMissing(error)) return { outcome: "no_subscription" } satisfies Early;
        throw error;
      }
      if (listed.truncated) {
        // Fail closed: the part that was not read may hold the subscription
        // that decides (an older live one, or one with paid time left).
        reportBillingError("Customer has more subscriptions than are read: nothing was stored from the partial list", {
          customerId: customer,
          read: listed.notCanceled.length + listed.canceled.length,
          userId,
        });
        return { outcome: "listing_truncated" } satisfies Early;
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
        standingFollows: options.standing === true,
      });
      return { hasLiveSubscription: live.length > 0, outcome, primary, state } satisfies Reading;
    },
    isReading,
    options,
  );
  if (!isReading(result)) return result;
  const paymentIntentId =
    eventSubscriptionId === result.primary.id ? (options.standingPaymentIntentId ?? null) : null;
  const standing = options.standing
    ? await storePaymentStanding(db, stripe, lease, result.primary, paymentIntentId)
    : undefined;
  return {
    hasLiveSubscription: result.hasLiveSubscription,
    ...(options.standing ? { standing } : {}),
    // An authoritative write is only ever refused for being older.
    outcome: result.outcome === "applied" ? "applied" : "stale",
    state: result.state,
  };
}

/**
 * Re-derives a user's subscription row from everything Stripe has for their
 * customer: the subscription with precedence (pickPrimarySubscription).
 * Repairs the row after a missed or failed webhook. `customerId` overrides
 * the stored customer (for a user who has none stored yet). Runs under the
 * customer's lease.
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
    (await db.user.findFirst({ select: { stripeId: true }, where: { ...INCLUDING_DELETED, id: userId } }))?.stripeId ??
    null;
  if (!customer) return { outcome: "no_customer" };
  return withCustomerLease(db, customer, options, (lease) =>
    syncUserLocked(db, stripe, lease, userId, customer, options),
  );
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
