// Billing for a deleted account (src/server/_lib/account/deletion.ts):
// nothing may be charged after the account is gone.
//
// - Deletion calls `endBillingForClosedAccount` for the member's
//   subscription.
// - A webhook or re-sync that resolves to a deleted account still stores the
//   subscription's state (the row is the billing record) and then calls it
//   too, which covers a checkout completed in another tab after deletion.

import type Stripe from "stripe";

import { logger } from "~/_utils";
import { INCLUDING_DELETED } from "~/server/_db/softDelete";

import { isTerminalStatus } from "./entitlements";
import { isStripeResourceMissing } from "./stripe";
import type { BillingDb } from "./subscriptionStore";

/** Open invoices voided per subscription; a subscription has one or two at most. */
const MAX_OPEN_INVOICES = 20;

/** Whether `userId` is an account that has been deleted (or is being deleted). */
export async function isClosedAccount(db: Pick<BillingDb, "user">, userId: string): Promise<boolean> {
  return (await db.user.count({ where: { ...INCLUDING_DELETED, id: userId, isDeleted: true } })) > 0;
}

/**
 * Cancels `subscriptionId` now (no proration, no final invoice) unless it
 * has already ended, then voids its open invoices so that a retry of a
 * failed payment cannot charge the card. Idempotent; a subscription Stripe
 * does not know is nothing to do. Throws on any other Stripe error, so the
 * caller retries.
 */
export async function endBillingForClosedAccount(stripe: Stripe, subscriptionId: string): Promise<void> {
  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    if (isStripeResourceMissing(error)) return;
    throw error;
  }
  if (!isTerminalStatus(subscription.status)) {
    await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
    logger.info("Subscription of a deleted account cancelled", { subscriptionId });
  }
  const open = await stripe.invoices.list({ limit: MAX_OPEN_INVOICES, status: "open", subscription: subscriptionId });
  for (const invoice of open.data) {
    if (invoice.id) await stripe.invoices.voidInvoice(invoice.id);
  }
}
