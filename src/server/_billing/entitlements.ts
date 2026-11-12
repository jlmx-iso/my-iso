/**
 * What a user's subscription entitles them to, derived from the stored
 * subscription state (which mirrors Stripe, see ./subscriptionStore.ts).
 *
 * This is the ONE place that turns billing state into access. Everything
 * here is pure except `getEntitlements`/`hasProAccess`, which only read the
 * row. Nothing gates on it yet; feature gating uses these functions.
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

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return SUBSCRIPTION_STATUSES.some((status) => status === value);
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.some((terminal) => terminal === status);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a `past_due` subscription keeps access, counted from the start
 * of the unpaid period (the renewal whose invoice failed).
 *
 * `past_due` means Stripe is still retrying the payment. Access continues
 * through that window instead of being cut on the first failed charge, but
 * not for ever: if the account's retry settings leave subscriptions
 * `past_due` after the last retry, access still ends here. Keep this at or
 * above the retry schedule configured in the Stripe dashboard (Billing →
 * Revenue recovery → Retries; Smart Retries run for up to 3 weeks by
 * default).
 */
export const PAST_DUE_GRACE_DAYS = 21;

/**
 * Whether a subscription that was cancelled outright at the customer's or
 * the merchant's request (status `canceled` before the end of the period it
 * had paid for) keeps access until that period ends.
 *
 * Does not apply to subscriptions Stripe cancelled for non-payment or a
 * dispute: those never paid for the period. NOTE: Stripe does not tell a
 * plain "cancel immediately" from "refund and cancel"; to end access at
 * once for a refunded customer, set this to false or cancel with the
 * subscription's period shortened.
 */
export const CANCELED_KEEPS_PAID_PERIOD = true;

/** The stored fields entitlements are derived from. */
export type SubscriptionSnapshot = {
  cancelAt: Date | null;
  cancelAtPeriodEnd: boolean;
  cancellationReason: string | null;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  interval: string | null;
  isLifetime: boolean;
  plan: string | null;
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
  /** A payment failed and has not been recovered. */
  isPastDue: boolean;
  reason: AccessReason;
};

const NO_ACCESS: Entitlements = {
  accessEndsAt: null,
  hasProAccess: false,
  isPastDue: false,
  reason: "none",
};

/** End of the grace window of a past-due subscription, if it can be told. */
function pastDueGraceEnd(subscription: SubscriptionSnapshot): Date | null {
  return subscription.currentPeriodStart
    ? new Date(subscription.currentPeriodStart.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS)
    : null;
}

/**
 * Entitlements of a user whose subscription row is `subscription` (null: no
 * row) at time `now`.
 *
 * - `active`, `trialing`: access.
 * - `past_due`: access during the grace window (see PAST_DUE_GRACE_DAYS).
 * - `canceled`: access until the end of the period already paid for, when
 *   the cancellation was requested rather than caused by non-payment.
 * - `unpaid`, `incomplete`, `incomplete_expired`, `paused`, anything
 *   unknown: no access.
 * - A lifetime (comped) account always has access.
 */
export function entitlementsFor(
  subscription: SubscriptionSnapshot | null,
  now: Date,
): Entitlements {
  if (!subscription) return NO_ACCESS;
  if (subscription.isLifetime) {
    return { accessEndsAt: null, hasProAccess: true, isPastDue: false, reason: "lifetime" };
  }

  const nowMs = now.getTime();
  switch (subscription.status) {
    case "active":
    case "trialing":
      return {
        accessEndsAt: subscription.cancelAtPeriodEnd ? subscription.cancelAt : null,
        hasProAccess: true,
        isPastDue: false,
        reason: subscription.status,
      };

    case "past_due": {
      const graceEnd = pastDueGraceEnd(subscription);
      // Without a period start there is nothing to count the window from;
      // Stripe is retrying, so access continues.
      if (!graceEnd || graceEnd.getTime() > nowMs) {
        return { accessEndsAt: graceEnd, hasProAccess: true, isPastDue: true, reason: "past_due_grace" };
      }
      return { ...NO_ACCESS, isPastDue: true };
    }

    case "canceled": {
      const paidUntil = subscription.currentPeriodEnd;
      if (
        CANCELED_KEEPS_PAID_PERIOD &&
        subscription.cancellationReason === "cancellation_requested" &&
        paidUntil &&
        paidUntil.getTime() > nowMs
      ) {
        return { accessEndsAt: paidUntil, hasProAccess: true, isPastDue: false, reason: "canceled_paid_period" };
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
