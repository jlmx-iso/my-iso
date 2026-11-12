import type { Subscription } from "@prisma/client";
import type Stripe from "stripe";

import { logger } from "~/_utils";
import { runAfterResponse } from "~/server/_lib/background";

import { refreshBillingState } from "./checkout";
import { entitlementsFor } from "./entitlements";
import { claimFor, extendClaim, LeaseBusyError } from "./lease";
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
 * - It does not queue behind other billing work: it waits at most
 *   LAZY_SYNC_LEASE_WAIT_MS for the customer's lease. A busy lease means a
 *   webhook, checkout or re-sync is reading the same customer right now;
 *   the stored row is used and the row is looked at again shortly.
 * - A sync that runs past the budget is not abandoned while it holds the
 *   lease: it is handed to `waitUntil` (runAfterResponse), which lets it
 *   finish after the response, and the Stripe client it uses gives up on
 *   each call after three seconds without retrying
 *   (getAccessCheckStripe). That limit is per call: a sync is normally
 *   five or six calls, but a derivation can make many more in sequence and
 *   so can still be cut off at the 30 seconds Workers allow. A row is
 *   settled only when its standing has been recorded (`standingSyncedAt`),
 *   so work cut off before or after the subscription write leaves a row
 *   that still qualifies and is tried again; the lease it held expires.
 * - It is attempted at most once per LAZY_SYNC_RETRY_SECONDS per row,
 *   across all isolates (a claim in BillingLease). After ANY answer from
 *   Stripe that leaves the row still qualifying (nothing at Stripe for it,
 *   a subscription on another customer, unknown customer, ...), the next
 *   attempt is LAZY_SYNC_UNRESOLVED_SECONDS away: asking again sooner
 *   would get the same answer. So such a row costs one look a day, not
 *   one per request or one every ten minutes.
 * - A row that is not settled is reported with its id.
 */
export const LAZY_SYNC_BUDGET_MS = 5_000;
export const LAZY_SYNC_LEASE_WAIT_MS = 1_000;
export const LAZY_SYNC_RETRY_SECONDS = 10 * 60;
export const LAZY_SYNC_BUSY_RETRY_SECONDS = 30;
export const LAZY_SYNC_UNRESOLVED_SECONDS = 24 * 60 * 60;

export type LazySyncOptions = {
  /**
   * Keeps a sync that outlived the budget running until it settles.
   * Defaults to `waitUntil` on Workers (runAfterResponse); for tests.
   */
  afterResponse?: (work: Promise<unknown>) => void;
  budgetMs?: number;
  /** The clock in milliseconds; for tests. */
  now?: () => number;
  sync?: SyncOptions;
};

const TIMED_OUT = Symbol("timed out");
const BUSY = Symbol("customer busy");

function withBudget<T>(work: Promise<T>, budgetMs: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const finishAfterResponse = (work: Promise<unknown>) => runAfterResponse("billing-first-sync", () => work);

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

    const sync = refreshBillingState(db, getStripe(), userId, {
      leaseWaitMs: LAZY_SYNC_LEASE_WAIT_MS,
      ...options.sync,
      standing: true,
    }).catch((error: unknown): typeof BUSY => {
      if (error instanceof LeaseBusyError) return BUSY;
      throw error;
    });
    const result = await withBudget(sync, options.budgetMs ?? LAZY_SYNC_BUDGET_MS);

    if (result === BUSY) {
      // Someone else is syncing this customer; their result is the row.
      await extendClaim(db, claim, LAZY_SYNC_BUSY_RETRY_SECONDS, now());
      logger.info("Lazy first sync skipped: the customer is being synced elsewhere", { subscriptionRowId: row.id });
      return await db.subscription.findUnique({ where: { userId } });
    }
    if (result === TIMED_OUT) {
      // Still running, and holding the customer's lease: let it finish
      // (and release) instead of leaving it to be cut off with the request.
      (options.afterResponse ?? finishAfterResponse)(sync.catch(() => undefined));
    }

    const outcome: ResyncOutcome = result === TIMED_OUT ? "failed" : result.outcome;
    const current = await db.subscription.findUnique({ where: { userId } });
    // Stripe answered and the row still qualifies: the same question would
    // get the same answer, so it is not asked again for a day.
    if (outcome !== "failed" && current && rowNeedsFirstSync(current)) {
      await extendClaim(db, claim, LAZY_SYNC_UNRESOLVED_SECONDS, now());
    }
    if (isUnresolved(outcome, entitlementsFor(current, new Date(now())).hasProAccess)) {
      reportBillingError("Subscription row could not be settled from Stripe on first use", {
        outcome: result === TIMED_OUT ? "timed_out" : outcome,
        subscriptionRowId: row.id,
      });
    }
    return current;
  } catch (error) {
    reportBillingError("Lazy first sync of a subscription row failed", { error, subscriptionRowId: row.id });
    return row;
  }
}
