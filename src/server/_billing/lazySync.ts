import type { Subscription } from "@prisma/client";
import type Stripe from "stripe";

import { refreshBillingState } from "./checkout";
import { entitlementsFor } from "./entitlements";
import { claimFor, extendClaim } from "./lease";
import { reportBillingError } from "./report";
import { isUnresolved, rowNeedsFirstSync, type ResyncOutcome } from "./resync";
import type { BillingDb, SyncOptions } from "./subscriptionStore";

/**
 * The lazy first sync: a subscription row that has never been read from
 * Stripe (back-filled by migration 0003 from the legacy flags), or that the
 * previous release wrote to during the cutover (null `subscriptionId` /
 * `expiresAt`), brings itself up to date the first time access is decided
 * on it, instead of waiting for the next webhook or for someone to run the
 * re-sync script.
 *
 * The rule, also in docs/BILLING.md:
 *
 * - It never throws into the request and never takes longer than
 *   LAZY_SYNC_BUDGET_MS. If Stripe cannot be reached in that time, or the
 *   row cannot be settled, the decision is made from the row AS STORED
 *   (what the migration back-filled, which is what the previous release
 *   decided): access is neither granted nor taken away on a guess.
 * - It is attempted at most once per LAZY_SYNC_RETRY_SECONDS per row,
 *   across all isolates (a claim in BillingLease), and once per
 *   LAZY_SYNC_UNRESOLVED_SECONDS for a row that Stripe gave a definite
 *   answer about that did not settle it. So an unresolvable row costs one
 *   Stripe call a day, not one per request.
 * - A row that is not settled is reported with its id.
 */
export const LAZY_SYNC_BUDGET_MS = 5_000;
export const LAZY_SYNC_RETRY_SECONDS = 10 * 60;
export const LAZY_SYNC_UNRESOLVED_SECONDS = 24 * 60 * 60;

export type LazySyncOptions = {
  budgetMs?: number;
  /** The clock in milliseconds; for tests. */
  now?: () => number;
  sync?: SyncOptions;
};

const TIMED_OUT = Symbol("timed out");

function withBudget<T>(work: Promise<T>, budgetMs: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The user's subscription row for an access decision: as stored, after the
 * lazy first sync if the row needed one. `getStripe` is called only then.
 */
export async function loadSubscriptionForAccess(
  db: BillingDb,
  getStripe: () => Stripe,
  userId: string,
  options: LazySyncOptions = {},
): Promise<Subscription | null> {
  const row = await db.subscription.findUnique({ where: { userId } });
  if (!row || !rowNeedsFirstSync(row)) return row;

  try {
    const now = options.now ?? Date.now;
    if (!row.subscriptionId) {
      // Nothing names a subscription; is there a customer to ask about?
      const user = await db.user.findUnique({ select: { stripeId: true }, where: { id: userId } });
      if (!user?.stripeId) return row;
    }

    const claim = `first-sync:${row.id}`;
    if (!(await claimFor(db, claim, LAZY_SYNC_RETRY_SECONDS, now()))) return row;

    // A sync that runs past the budget is left to finish (or to be cut off
    // with the request); it is idempotent, and its rejection is not ours.
    const sync = refreshBillingState(db, getStripe(), userId, { ...options.sync, standing: true });
    sync.catch(() => undefined);
    const result = await withBudget(sync, options.budgetMs ?? LAZY_SYNC_BUDGET_MS);

    const outcome: ResyncOutcome = result === TIMED_OUT ? "failed" : result.outcome;
    const current = await db.subscription.findUnique({ where: { userId } });
    if (!isUnresolved(outcome, entitlementsFor(current, new Date(now())).hasProAccess)) return current;

    if (outcome !== "failed") await extendClaim(db, claim, LAZY_SYNC_UNRESOLVED_SECONDS, now());
    reportBillingError("Subscription row could not be settled from Stripe on first use", {
      outcome: result === TIMED_OUT ? "timed_out" : outcome,
      subscriptionRowId: row.id,
    });
    return current;
  } catch (error) {
    reportBillingError("Lazy first sync of a subscription row failed", { error, subscriptionRowId: row.id });
    return row;
  }
}
