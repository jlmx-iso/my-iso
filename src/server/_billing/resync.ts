import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import { refreshBillingState, type RefreshOutcome } from "./checkout";
import { ENTITLING_STATUSES, entitlementsFor } from "./entitlements";
import { MAX_STANDING_STRIPE_CALLS } from "./paymentStanding";
import { reportBillingError } from "./report";
import { MAX_READINGS, MAX_SUBSCRIPTION_PAGES, type BillingDb, type SyncOptions } from "./subscriptionStore";

/**
 * Re-derives stored subscription rows from Stripe in bounded batches: the
 * one-time step after the release that introduced the mirrored state, and
 * a repair tool afterwards. See docs/BILLING.md ("After deploying").
 *
 * Safe to run again at any time and to interrupt: each row is brought up
 * to date by the same idempotent sync a webhook uses, nothing is written
 * that Stripe does not say, and a row that fails is counted and skipped.
 */

/**
 * What one batch may cost, against the Worker's subrequest limit (every
 * `fetch`, so every Stripe request, and every D1 statement counts).
 *
 * The app runs on the Workers PAID plan (its bundle is over the Free
 * plan's size limit), where an invocation may make 10,000 subrequests by
 * default. SUBREQUEST_BUDGET is what a batch is held to, well inside that
 * and inside the 1,000 that was the Paid limit until 2026. The Free plan's
 * 50 external subrequests would NOT be enough for one batch.
 *
 * Per row, at the very worst:
 *
 * - Stripe, the customer's subscriptions: two listings (not cancelled,
 *   cancelled) of up to MAX_SUBSCRIPTION_PAGES pages, read up to
 *   MAX_READINGS times if readings tie;
 * - Stripe, the row's own subscription when the list is empty: up to
 *   MAX_READINGS readings, one to learn its customer, one for the customer;
 * - Stripe, the payment standing: MAX_STANDING_STRIPE_CALLS;
 * - D1: the lease (up to about eight attempts to take it, one to release),
 *   the guarded writes and the reads around them, and one upsert per
 *   dispute known for the subscription: under D1_STATEMENTS_PER_ROW.
 *
 * A row normally costs four or five Stripe requests and a dozen statements.
 */
export const SUBREQUEST_BUDGET = 1000;
export const D1_STATEMENTS_PER_ROW = 50;
export const MAX_STRIPE_CALLS_PER_ROW =
  2 * MAX_SUBSCRIPTION_PAGES * MAX_READINGS + (MAX_READINGS + 2) + MAX_STANDING_STRIPE_CALLS;
export const MAX_SUBREQUESTS_PER_ROW = MAX_STRIPE_CALLS_PER_ROW + D1_STATEMENTS_PER_ROW;

/**
 * Rows per call: the most that fit in SUBREQUEST_BUDGET at the worst case
 * per row, and no more than ten. (Eight, with the bounds as they are.)
 */
export const RESYNC_MAX_BATCH = Math.min(10, Math.floor(SUBREQUEST_BUDGET / MAX_SUBREQUESTS_PER_ROW));

/**
 * Which rows a batch looks at.
 *
 * - "pending": rows that were never read from Stripe (`stripeSyncedAt` is
 *   null: back-filled by the migration, or created by the previous release
 *   while both were serving), rows whose payment standing has not been
 *   derived completely and recorded (`standingSyncedAt` is null), and rows
 *   the previous release wrote to
 *   during that overlap: legacy flags that disagree with `status`, a
 *   `subscriptionId` that is null, or an `expiresAt` that is null although
 *   the period end is known (this release always writes these together;
 *   the previous one, once the webhook endpoint's API version has been
 *   changed, writes null for both: see docs/BILLING.md, "cutover").
 * - "all": every row that has a Stripe subscription or customer.
 */
export type ResyncScope = "pending" | "all";

const entitling = [...ENTITLING_STATUSES];

/** Legacy flags as the previous release wrote them, contradicting `status`. */
const LEGACY_FLAGS_DISAGREE: Prisma.SubscriptionWhereInput[] = [
  { isActive: true, status: { notIn: entitling } },
  { isActive: false, status: { in: entitling } },
  { isExpired: true, status: { notIn: ["canceled", "unpaid", "incomplete_expired"] } },
  { isCanceled: true, cancelAtPeriodEnd: false, status: { not: "canceled" } },
];

const hasSomethingAtStripe: Prisma.SubscriptionWhereInput = {
  OR: [{ subscriptionId: { not: null } }, { user: { stripeId: { not: null } } }],
};

/** Written by the previous release after the endpoint's API version changed. */
const WRITTEN_BY_PREVIOUS_RELEASE: Prisma.SubscriptionWhereInput[] = [
  { subscriptionId: null },
  { currentPeriodEnd: { not: null }, expiresAt: null },
];

export function resyncScopeFilter(scope: ResyncScope): Prisma.SubscriptionWhereInput {
  if (scope === "all") return hasSomethingAtStripe;
  return {
    AND: [
      hasSomethingAtStripe,
      {
        OR: [
          { stripeSyncedAt: null },
          // Read from Stripe, but its payment standing never derived
          // completely (the work was cut off, or the history was incomplete).
          { standingSyncedAt: null },
          ...LEGACY_FLAGS_DISAGREE,
          ...WRITTEN_BY_PREVIOUS_RELEASE,
        ],
      },
    ],
  };
}

/**
 * The same question for one row in hand, without the legacy-flag
 * comparison: has this row never been read from Stripe, or been written by
 * the previous release since? Used for the lazy first sync on an access
 * check (./lazySync.ts).
 */
export function rowNeedsFirstSync(row: {
  currentPeriodEnd: Date | null;
  expiresAt: Date | null;
  isLifetime: boolean;
  standingSyncedAt: Date | null;
  stripeSyncedAt: Date | null;
  subscriptionId: string | null;
}): boolean {
  if (row.isLifetime) return false;
  return (
    row.stripeSyncedAt === null ||
    row.standingSyncedAt === null ||
    row.subscriptionId === null ||
    (row.expiresAt === null && row.currentPeriodEnd !== null)
  );
}

export type ResyncOutcome = RefreshOutcome | "failed";

/**
 * Why a row is listed as unresolved. "standing_incomplete": the row was
 * brought up to date, but its payment standing was derived from an
 * incomplete history (./paymentStanding.ts) and needs a person.
 */
export type UnresolvedReason = ResyncOutcome | "standing_incomplete";

/**
 * Whether a row is settled after a sync that ended in `outcome`. Not
 * settled: the sync failed or could not read everything, the row's
 * subscription cannot be matched to the user or does not exist at Stripe,
 * or Stripe has nothing for the customer while the row still grants access
 * (nothing was changed: someone has to look).
 */
export function isUnresolved(outcome: ResyncOutcome, grantsAccess: boolean): boolean {
  switch (outcome) {
    case "applied":
    case "stale":
      return false;
    case "nothing_at_stripe":
      return grantsAccess;
    default:
      return true;
  }
}

export type ResyncBatchResult = {
  /** Pass back as `cursor` for the next batch; null when this was the last. */
  nextCursor: string | null;
  /** How many rows ended in each outcome ("failed": Stripe or the database threw). */
  outcomes: Partial<Record<ResyncOutcome, number>>;
  processed: number;
  /**
   * The rows of this batch that are NOT settled (see isUnresolved), by
   * Subscription id, with the outcome that left them so. "failed" rows are
   * retried by running the batch again; the others need a person
   * (docs/BILLING.md).
   */
  unresolved: Array<{ id: string; outcome: UnresolvedReason }>;
};

/**
 * Processes up to `limit` rows after `cursor` (a Subscription id), in id
 * order. Comped rows are left alone. A row whose subscription belongs to a
 * customer that is not stored on the user ends as "unknown_customer" and is
 * not changed: ownership is never inferred from the legacy row.
 */
export async function resyncSubscriptionBatch(
  db: BillingDb,
  stripe: Stripe,
  input: { cursor?: string | null; limit?: number; scope?: ResyncScope },
  options: SyncOptions = {},
): Promise<ResyncBatchResult> {
  const limit = Math.max(1, Math.min(input.limit ?? RESYNC_MAX_BATCH, RESYNC_MAX_BATCH));
  const rows = await db.subscription.findMany({
    orderBy: { id: "asc" },
    select: { id: true, userId: true },
    take: limit + 1,
    where: {
      AND: [
        resyncScopeFilter(input.scope ?? "pending"),
        { isLifetime: false },
        ...(input.cursor ? [{ id: { gt: input.cursor } }] : []),
      ],
    },
  });
  const batch = rows.slice(0, limit);

  const outcomes: ResyncBatchResult["outcomes"] = {};
  const unresolved: ResyncBatchResult["unresolved"] = [];
  for (const row of batch) {
    let outcome: ResyncOutcome;
    let standingIncomplete = false;
    try {
      // With the payment standing: disputes and refunds are derived from
      // Stripe along with the subscription.
      const refreshed = await refreshBillingState(db, stripe, row.userId, { ...options, standing: true });
      outcome = refreshed.outcome;
      standingIncomplete = refreshed.standingIncomplete === true;
    } catch (error) {
      outcome = "failed";
      reportBillingError("Subscription re-sync failed for a row", { error, subscriptionRowId: row.id });
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;

    if (outcome === "applied" || outcome === "stale") {
      // Already reported, with the row's id, where the standing was stored.
      if (standingIncomplete) unresolved.push({ id: row.id, outcome: "standing_incomplete" });
      continue;
    }
    const stored = outcome === "nothing_at_stripe" ? await db.subscription.findUnique({ where: { id: row.id } }) : null;
    const grantsAccess = entitlementsFor(stored, new Date()).hasProAccess;
    if (!isUnresolved(outcome, grantsAccess)) continue;
    unresolved.push({ id: row.id, outcome });
    if (outcome !== "failed") {
      reportBillingError("Subscription row could not be settled from Stripe", { outcome, subscriptionRowId: row.id });
    }
  }

  return {
    nextCursor: rows.length > limit ? (batch.at(-1)?.id ?? null) : null,
    outcomes,
    processed: batch.length,
    unresolved,
  };
}
