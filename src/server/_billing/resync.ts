import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import { refreshBillingState, type RefreshOutcome } from "./checkout";
import { ENTITLING_STATUSES } from "./entitlements";
import { reportBillingError } from "./report";
import type { BillingDb, SyncOptions } from "./subscriptionStore";

/**
 * Re-derives stored subscription rows from Stripe in bounded batches: the
 * one-time step after the release that introduced the mirrored state, and
 * a repair tool afterwards. See docs/BILLING.md ("After deploying").
 *
 * Safe to run again at any time and to interrupt: each row is brought up
 * to date by the same idempotent sync a webhook uses, nothing is written
 * that Stripe does not say, and a row that fails is counted and skipped.
 */

/** Rows per call: each costs up to four Stripe requests, and a Worker invocation has a subrequest budget. */
export const RESYNC_MAX_BATCH = 10;

/**
 * Which rows a batch looks at.
 *
 * - "pending": rows that were never read from Stripe (`stripeSyncedAt` is
 *   null: back-filled by the migration, or created by the previous release
 *   while both were serving), and rows whose legacy flags disagree with
 *   `status` (the previous release changed the flags of an existing row
 *   during that overlap; this release always writes both together).
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

export function resyncScopeFilter(scope: ResyncScope): Prisma.SubscriptionWhereInput {
  if (scope === "all") return hasSomethingAtStripe;
  return {
    AND: [hasSomethingAtStripe, { OR: [{ stripeSyncedAt: null }, ...LEGACY_FLAGS_DISAGREE] }],
  };
}

export type ResyncBatchResult = {
  /** Pass back as `cursor` for the next batch; null when this was the last. */
  nextCursor: string | null;
  /** How many rows ended in each outcome ("failed": Stripe or the database threw). */
  outcomes: Partial<Record<RefreshOutcome | "failed", number>>;
  processed: number;
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
  for (const row of batch) {
    let outcome: RefreshOutcome | "failed";
    try {
      outcome = (await refreshBillingState(db, stripe, row.userId, options)).outcome;
    } catch (error) {
      outcome = "failed";
      reportBillingError("Subscription re-sync failed for a row", { error, subscriptionRowId: row.id });
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }

  return {
    nextCursor: rows.length > limit ? (batch.at(-1)?.id ?? null) : null,
    outcomes,
    processed: batch.length,
  };
}
