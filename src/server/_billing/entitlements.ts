/**
 * What a user's subscription entitles them to, derived from the stored
 * subscription state (which mirrors Stripe, see ./subscriptionStore.ts).
 *
 * This is the ONE place that turns billing state into access. Everything
 * here is pure except `getEntitlements`/`hasProAccess`, which only read the
 * row. Feature gating uses these functions (see `proProcedure`).
 */

/** Stripe's subscription statuses. */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Statuses a subscription never leaves: a new checkout may start. */
export const TERMINAL_STATUSES = ["canceled", "incomplete_expired"] as const satisfies readonly SubscriptionStatus[];

/**
 * Statuses that can carry Pro access on their own (subject to the grace,
 * dispute and refund rules below).
 */
export const ENTITLING_STATUSES = ["active", "trialing", "past_due"] as const satisfies readonly SubscriptionStatus[];

/** Stripe's `cancellation_details.reason` for a cancellation someone asked for. */
export const CANCELLATION_REQUESTED = "cancellation_requested";

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return SUBSCRIPTION_STATUSES.some((status) => status === value);
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.some((terminal) => terminal === status);
}

export function isEntitlingStatus(status: string): boolean {
  return ENTITLING_STATUSES.some((entitling) => entitling === status);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a `past_due` subscription keeps access, counted from the moment
 * it FIRST became past due (`pastDueSince`), not from the start of whatever
 * billing period it is in.
 *
 * `past_due` means Stripe is still retrying the payment. Access continues
 * through that window instead of being cut on the first failed charge, but
 * not for ever: if the account's retry settings leave subscriptions
 * `past_due` after the last retry, access still ends here, and a new
 * billing period opening while the subscription is still past due does not
 * start another window. Keep this at or above the retry schedule configured
 * in the Stripe dashboard (Billing → Revenue recovery → Retries; Smart
 * Retries run for up to 3 weeks by default).
 */
export const PAST_DUE_GRACE_DAYS = 21;

/**
 * Whether a subscription that was cancelled outright at the customer's or
 * the merchant's request (status `canceled` before the end of the period it
 * had paid for) keeps access until that period ends.
 *
 * Only for a period that WAS paid for (`paidThroughAt`) and whose payment
 * has not been refunded in full or lost to a dispute. Does not apply to
 * subscriptions Stripe cancelled for non-payment or a dispute.
 */
export const CANCELED_KEEPS_PAID_PERIOD = true;

/** The stored fields entitlements are derived from. */
export type SubscriptionSnapshot = {
  cancelAt: Date | null;
  cancelAtPeriodEnd: boolean;
  cancellationReason: string | null;
  /** The invoice a disputed charge paid, and "open" | "lost". */
  disputeInvoiceId: string | null;
  disputeStatus: string | null;
  isLifetime: boolean;
  latestInvoiceId: string | null;
  /** End of the current period, when its invoice is paid; else null. */
  paidThroughAt: Date | null;
  /** When the subscription first became past due; null when it is not. */
  pastDueSince: Date | null;
  /** The invoice whose payment was refunded in full, if any. */
  refundedInvoiceId: string | null;
  status: string;
};

export type AccessReason =
  /** Comped account. */
  | "lifetime"
  | "active"
  | "trialing"
  /** Payment failed; Stripe is retrying and access continues meanwhile. */
  | "past_due_grace"
  /** Cancelled, with paid time left. */
  | "canceled_paid_period"
  | "none";

export type Entitlements = {
  /**
   * When access ends unless something changes: the cancellation date, the
   * end of the past-due grace window, or the end of the paid period of a
   * cancelled subscription. Null when access is open-ended (it renews) or
   * there is none.
   */
  accessEndsAt: Date | null;
  hasProAccess: boolean;
  /**
   * Access is withheld because of a dispute (chargeback): one is open on a
   * payment of this subscription, or the payment for the current period
   * was lost to one.
   */
  isDisputed: boolean;
  /** A payment failed and has not been recovered. */
  isPastDue: boolean;
  reason: AccessReason;
};

const NO_ACCESS: Entitlements = {
  accessEndsAt: null,
  hasProAccess: false,
  isDisputed: false,
  isPastDue: false,
  reason: "none",
};

const GRANTED = { hasProAccess: true, isDisputed: false, isPastDue: false } as const;

/** The payment for the current period was taken back through a dispute. */
function currentPeriodLostToDispute(subscription: SubscriptionSnapshot): boolean {
  return (
    subscription.disputeStatus === "lost" &&
    subscription.disputeInvoiceId !== null &&
    subscription.disputeInvoiceId === subscription.latestInvoiceId
  );
}

/** The payment for the current period was refunded in full. */
function currentPeriodRefunded(subscription: SubscriptionSnapshot): boolean {
  return (
    subscription.refundedInvoiceId !== null &&
    subscription.refundedInvoiceId === subscription.latestInvoiceId
  );
}

/**
 * Entitlements of a user whose subscription row is `subscription` (null: no
 * row) at time `now`. The full table, with the reasoning, is in
 * docs/BILLING.md.
 *
 * 1. A lifetime (comped) account always has access.
 * 2. A dispute comes before the status: no access while one is open on a
 *    payment of the subscription, nor when the payment for the current
 *    period was lost to one (until a later invoice is paid).
 * 3. `active`, `trialing`: access, unless the subscription is set to end
 *    and that time has passed.
 * 4. `past_due`: access for PAST_DUE_GRACE_DAYS from `pastDueSince`. No
 *    anchor, no access.
 * 5. `canceled`: access until `paidThroughAt` when the cancellation was
 *    requested (not non-payment), the period was paid for, and that payment
 *    was not refunded in full.
 * 6. `unpaid`, `incomplete`, `incomplete_expired`, `paused`, and any status
 *    this code does not know: no access.
 */
export function entitlementsFor(
  subscription: SubscriptionSnapshot | null,
  now: Date,
): Entitlements {
  if (!subscription) return NO_ACCESS;
  if (subscription.isLifetime) {
    return { ...GRANTED, accessEndsAt: null, reason: "lifetime" };
  }

  const isPastDue = subscription.status === "past_due" || subscription.status === "unpaid";
  if (subscription.disputeStatus === "open" || currentPeriodLostToDispute(subscription)) {
    return { ...NO_ACCESS, isDisputed: true, isPastDue };
  }

  const nowMs = now.getTime();
  switch (subscription.status) {
    case "active":
    case "trialing": {
      const endsAt = subscription.cancelAtPeriodEnd ? subscription.cancelAt : null;
      // Set to end, and that time has come: Stripe cancels it now, and the
      // event saying so may still be on its way. Access does not wait for it.
      if (endsAt && endsAt.getTime() <= nowMs) return NO_ACCESS;
      return { ...GRANTED, accessEndsAt: endsAt, reason: subscription.status };
    }

    case "past_due": {
      // Without the anchor there is nothing to count the window from, and
      // an uncounted window would be access without limit: deny.
      if (!subscription.pastDueSince) return { ...NO_ACCESS, isPastDue: true };
      const graceEnd = new Date(subscription.pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
      if (graceEnd.getTime() > nowMs) {
        return { ...GRANTED, accessEndsAt: graceEnd, isPastDue: true, reason: "past_due_grace" };
      }
      return { ...NO_ACCESS, isPastDue: true };
    }

    case "canceled": {
      const paidUntil = subscription.paidThroughAt;
      if (
        CANCELED_KEEPS_PAID_PERIOD &&
        subscription.cancellationReason === CANCELLATION_REQUESTED &&
        paidUntil &&
        paidUntil.getTime() > nowMs &&
        !currentPeriodRefunded(subscription)
      ) {
        return { ...GRANTED, accessEndsAt: paidUntil, reason: "canceled_paid_period" };
      }
      return NO_ACCESS;
    }

    case "unpaid":
      return { ...NO_ACCESS, isPastDue: true };

    default:
      return NO_ACCESS;
  }
}

type EntitlementsDb = {
  subscription: {
    findUnique: (args: { where: { userId: string } }) => Promise<SubscriptionSnapshot | null>;
  };
};

/** Entitlements of `userId` right now. */
export async function getEntitlements(
  db: EntitlementsDb,
  userId: string,
  now: Date = new Date(),
): Promise<Entitlements> {
  const subscription = await db.subscription.findUnique({ where: { userId } });
  return entitlementsFor(subscription, now);
}

/** Whether `userId` has Pro access right now. */
export async function hasProAccess(
  db: EntitlementsDb,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return (await getEntitlements(db, userId, now)).hasProAccess;
}
