import type Stripe from "stripe";

import { isStripeResourceMissing } from "./stripe";
import { disputeStanding, stripeId } from "./subscriptionState";

/**
 * What the disputes and refunds on a subscription's payments mean for
 * access, DERIVED from what Stripe has now.
 *
 * Nothing here is accumulated from webhook events. A dispute or refund
 * event only says that the standing of some subscription may have changed;
 * the standing is then computed from the customer's charges, their disputes
 * and the subscription's invoices as read at that moment, and stored whole
 * (subscriptionStore.writePaymentStanding, under the customer's lease). So
 * events may arrive late, twice or out of order; two disputes open at once
 * are both seen; a won dispute cannot hide another that is still open; and
 * a refund that failed is simply no longer a refund.
 */
export type PaymentStanding = {
  /** The dispute that decides `disputeStatus` (dp_...), for support. */
  disputeId: string | null;
  /** The invoice whose payment that dispute is about. */
  disputeInvoiceId: string | null;
  /**
   * - "open": a chargeback is in progress on a payment of the subscription.
   * - "lost": the most recent PAID invoice of the subscription was taken
   *   back through a dispute, so nothing paid for stands behind the
   *   subscription. It stays "lost" until a later invoice is paid; an
   *   unpaid renewal does not lift it.
   * - null: neither.
   */
  disputeStatus: "open" | "lost" | null;
  /**
   * Not stored: the standing was derived from less than everything (see
   * readPaymentStanding). The row is then reported as unresolved by id,
   * by the webhook and in the re-sync's `unresolved` list, for a person to
   * look at; it is never passed off as settled.
   */
  incomplete: boolean;
  /** The subscription's latest invoice, when its payment was refunded in full. */
  refundedInvoiceId: string | null;
};

/** Charges read per page, and the most pages, newest first. */
const CHARGES_PAGE_SIZE = 100;
const MAX_CHARGE_PAGES = 3;
/** One page each: a payment has a handful of these at most. */
const LIST_LIMIT = 100;

/**
 * Disputed charges older than this are history: a dispute must be opened
 * within 120 days of the charge (540 for a few card programmes) and is
 * decided within months, so nothing on a charge of two years ago can still
 * be open, and such a charge did not pay the latest invoice.
 */
const DISPUTE_HORIZON_SECONDS = 2 * 365 * 24 * 60 * 60;

/**
 * Disputed charges (within the horizon) whose disputes are read, newest
 * first. Each costs two Stripe calls, and a derivation runs inside a
 * webhook delivery and once per row of a re-sync batch, so it must be
 * bounded. More than this many in two years is not a customer whose
 * standing should be decided by arithmetic: see `unexamined` below.
 */
export const MAX_DISPUTED_CHARGES = 5;

/**
/** Payments of the latest invoice whose charge is read directly when the listing does not hold it. */
const MAX_UNLISTED_PAYMENTS_READ = 2;

/**
 * The most Stripe requests one derivation makes: the charge pages, the
 * charge an event is about, the dispute the row already names, two per
 * disputed charge examined, the invoices of the subscription, the payments
 * of its latest invoice, and those payments' charges where unlisted.
 */
export const MAX_STANDING_STRIPE_CALLS =
  MAX_CHARGE_PAGES + 1 + 1 + 2 * MAX_DISPUTED_CHARGES + 2 + MAX_UNLISTED_PAYMENTS_READ;

/**
 * The subscription invoice a payment paid, if it paid one.
 *
 * In this API version neither a charge nor a payment intent points at an
 * invoice: the link is the InvoicePayment object, listed by payment intent.
 * The invoice then names its subscription through `parent`.
 */
export async function findSubscriptionInvoice(
  stripe: Stripe,
  paymentIntentId: string | null,
): Promise<{ invoiceId: string; subscriptionId: string } | null> {
  if (!paymentIntentId) return null;
  const payments = await stripe.invoicePayments.list({
    expand: ["data.invoice"],
    limit: LIST_LIMIT,
    payment: { payment_intent: paymentIntentId, type: "payment_intent" },
  });
  for (const payment of payments.data) {
    const invoiceId = stripeId(payment.invoice);
    if (!invoiceId) continue;
    const invoice =
      typeof payment.invoice === "string" ? await stripe.invoices.retrieve(invoiceId) : payment.invoice;
    if (invoice.deleted) continue;
    const subscriptionId = stripeId(invoice.parent?.subscription_details?.subscription);
    if (subscriptionId) return { invoiceId, subscriptionId };
  }
  return null;
}

/** The customer's charges, newest first, as far as they are read. */
async function listCustomerCharges(
  stripe: Stripe,
  customerId: string,
): Promise<{ charges: Stripe.Charge[]; truncated: boolean }> {
  const charges: Stripe.Charge[] = [];
  let startingAfter: string | undefined;
  for (let page = 1; ; page += 1) {
    const list = await stripe.charges.list({
      customer: customerId,
      limit: CHARGES_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    charges.push(...list.data);
    startingAfter = list.data.at(-1)?.id;
    if (!list.has_more || !startingAfter) return { charges, truncated: false };
    if (page >= MAX_CHARGE_PAGES) return { charges, truncated: true };
  }
}

type SubscriptionDispute = { created: number; id: string; invoiceId: string; standing: "open" | "lost" };

/**
 * The open and lost disputes on charges that paid invoices of
 * `subscriptionId`, from MAX_DISPUTED_CHARGES disputed charges: first the
 * ones an event is about (`focus`, whatever their age), then the newest
 * within the horizon. `unexamined`: there were more than that.
 */
async function disputesOfSubscription(
  stripe: Stripe,
  subscriptionId: string,
  charges: readonly Stripe.Charge[],
  focus: readonly Stripe.Charge[],
  nowSeconds: number,
): Promise<{ disputes: SubscriptionDispute[]; unexamined: boolean }> {
  const focusIds = new Set(focus.map((charge) => charge.id));
  const disputed = [
    ...focus.filter((charge) => charge.disputed),
    ...charges
      .filter((charge) => !focusIds.has(charge.id))
      .filter((charge) => charge.disputed && charge.created >= nowSeconds - DISPUTE_HORIZON_SECONDS)
      .sort((a, b) => b.created - a.created),
  ];
  const found: SubscriptionDispute[] = [];
  for (const charge of disputed.slice(0, MAX_DISPUTED_CHARGES)) {
    const paid = await findSubscriptionInvoice(stripe, stripeId(charge.payment_intent));
    if (paid?.subscriptionId !== subscriptionId) continue;
    const disputes = await stripe.disputes.list({ charge: charge.id, limit: LIST_LIMIT });
    for (const dispute of disputes.data) {
      const standing = disputeStanding(dispute.status);
      if (standing === "cleared") continue;
      found.push({ created: dispute.created, id: dispute.id, invoiceId: paid.invoiceId, standing });
    }
  }
  return {
    disputes: found.sort((a, b) => b.created - a.created),
    unexamined: disputed.length > MAX_DISPUTED_CHARGES,
  };
}

/**
 * The lost dispute that still leaves the subscription unpaid for, if any:
 * the one on the most recent invoice that was actually PAID FOR. Once a
 * later invoice is paid (and not itself lost), an earlier loss no longer
 * withholds anything. A later invoice that is `paid` without money having
 * changed hands (a trial, a credit, a proration that came to nothing) is
 * not a payment and lifts nothing.
 */
async function standingLoss(
  stripe: Stripe,
  subscriptionId: string,
  lost: readonly SubscriptionDispute[],
): Promise<SubscriptionDispute | null> {
  if (lost.length === 0) return null;
  // Newest first; the most recent paid invoice is on the first page.
  const invoices = await stripe.invoices.list({ limit: LIST_LIMIT, status: "paid", subscription: subscriptionId });
  const newestPaidFor = invoices.data
    .filter((invoice) => invoice.amount_paid > 0)
    .sort((a, b) => b.created - a.created)[0];
  if (!newestPaidFor) return lost[0] ?? null;
  return lost.find((dispute) => dispute.invoiceId === newestPaidFor.id) ?? null;
}

/**
 * Whether every successful charge that paid `invoiceId` was refunded in
 * full. A payment whose charge is not among `charges` (the listing did not
 * reach it) has that charge read directly, by payment intent: "not in the
 * list" must never be taken for "not refunded".
 */
async function isRefundedInFull(
  stripe: Stripe,
  invoiceId: string,
  charges: readonly Stripe.Charge[],
): Promise<boolean> {
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: LIST_LIMIT, status: "paid" });
  const known = [...charges];
  let directReads = 0;
  for (const payment of payments.data) {
    const intent = stripeId(payment.payment.payment_intent);
    if (!intent || known.some((charge) => stripeId(charge.payment_intent) === intent)) continue;
    if (directReads >= MAX_UNLISTED_PAYMENTS_READ) break;
    directReads += 1;
    known.push(...(await stripe.charges.list({ limit: LIST_LIMIT, payment_intent: intent })).data);
  }
  const paying = payments.data.flatMap((payment) => {
    const intent = stripeId(payment.payment.payment_intent);
    const direct = stripeId(payment.payment.charge);
    return known.filter(
      (charge) =>
        charge.status === "succeeded" &&
        ((intent !== null && stripeId(charge.payment_intent) === intent) || charge.id === direct),
    );
  });
  // `refunded` is true only while succeeded refunds cover the whole charge:
  // a partial refund leaves it false, and a refund that fails afterwards
  // turns it false again.
  return paying.length > 0 && paying.every((charge) => charge.refunded);
}

/**
 * The dispute the row already names, as Stripe has it now, when it still
 * withholds something ("open" or "lost"). It is read by its id, so it is
 * part of every derivation whether or not the charge listing reaches its
 * charge: a derivation that cannot see a dispute must never clear it.
 */
async function storedDisputeNow(
  stripe: Stripe,
  stored: { disputeId: string | null; disputeInvoiceId: string | null },
): Promise<SubscriptionDispute | null> {
  if (!stored.disputeId) return null;
  let dispute: Stripe.Dispute;
  try {
    dispute = await stripe.disputes.retrieve(stored.disputeId);
  } catch (error) {
    // Stripe has no such dispute any more: nothing is withheld by it.
    if (isStripeResourceMissing(error)) return null;
    throw error;
  }
  const standing = disputeStanding(dispute.status);
  if (standing === "cleared" || !stored.disputeInvoiceId) return null;
  return { created: dispute.created, id: dispute.id, invoiceId: stored.disputeInvoiceId, standing };
}

/**
 * Reads the standing of `subscription` (as just read from Stripe, with
 * `latest_invoice` expanded) from Stripe, in at most
 * MAX_STANDING_STRIPE_CALLS requests. Null only when the subscription has
 * no customer.
 *
 * `paymentIntentId`: the payment a dispute or refund event is about. Its
 * charges are read directly, by payment intent, so the charge the event
 * concerns is always part of the derivation, however long the customer's
 * history is and however old the charge.
 *
 * `stored`: the dispute marker the row holds. That dispute is re-read by
 * its id and merged in, so a marker is cleared only on evidence about that
 * very dispute (it reads as won, withdrawn or gone; or it was lost and a
 * later invoice has been paid for), never because a derivation that could
 * not see its charge found nothing. The refund marker needs no such input:
 * the charges that paid the latest invoice are read directly when the
 * listing does not hold them.
 *
 * The work is bounded, and neither bound keeps the previous standing:
 *
 * - More charges than are read (MAX_CHARGE_PAGES pages): the standing is
 *   derived from the newest, plus the event's own. So a new dispute IS
 *   recorded and a won one DOES clear for such a customer. If charges
 *   within the dispute horizon were left unread, the result is marked
 *   `incomplete` (a dispute on one of those, whose events were all missed,
 *   would not be seen) and the row is reported for review.
 * - More disputed charges than are examined (MAX_DISPUTED_CHARGES), and
 *   none of the examined ones withholds access: FAIL CLOSED. The standing
 *   is "open" with no dispute named, and `incomplete`: an older dispute
 *   that may still be open was not looked at, and a customer with that
 *   many chargebacks in two years needs a person. It lifts by itself as
 *   the disputed charges age past the horizon; until then a comped account
 *   (`isLifetime`) is the override.
 */
export async function readPaymentStanding(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  options: {
    nowMs?: number;
    paymentIntentId?: string | null;
    stored?: { disputeId: string | null; disputeInvoiceId: string | null } | null;
  } = {},
): Promise<PaymentStanding | null> {
  const customerId = stripeId(subscription.customer);
  if (!customerId) return null;
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);

  const { charges: listed, truncated } = await listCustomerCharges(stripe, customerId);
  const focus = options.paymentIntentId
    ? (await stripe.charges.list({ limit: LIST_LIMIT, payment_intent: options.paymentIntentId })).data
    : [];
  const listedIds = new Set(listed.map((charge) => charge.id));
  const charges = [...listed, ...focus.filter((charge) => !listedIds.has(charge.id))];

  const examined = await disputesOfSubscription(stripe, subscription.id, listed, focus, nowSeconds);
  const { unexamined } = examined;
  const stored = options.stored ? await storedDisputeNow(stripe, options.stored) : null;
  const disputes =
    stored && !examined.disputes.some((dispute) => dispute.id === stored.id)
      ? [...examined.disputes, stored].sort((a, b) => b.created - a.created)
      : examined.disputes;
  const open = disputes.find((dispute) => dispute.standing === "open");
  const deciding =
    open ??
    (await standingLoss(
      stripe,
      subscription.id,
      disputes.filter((dispute) => dispute.standing === "lost"),
    ));

  const invoice = subscription.latest_invoice;
  const latestPaidInvoiceId = invoice && typeof invoice !== "string" && invoice.status === "paid" ? invoice.id : null;
  const refunded = latestPaidInvoiceId !== null && (await isRefundedInFull(stripe, latestPaidInvoiceId, charges));
  const refundedInvoiceId = refunded ? latestPaidInvoiceId : null;

  if (!deciding && unexamined) {
    return { disputeId: null, disputeInvoiceId: null, disputeStatus: "open", incomplete: true, refundedInvoiceId };
  }

  // Unread charges that are recent enough to carry a live dispute.
  const oldestRead = listed.at(-1);
  const unreadWithinHorizon =
    truncated && oldestRead !== undefined && oldestRead.created >= nowSeconds - DISPUTE_HORIZON_SECONDS;
  return {
    disputeId: deciding?.id ?? null,
    disputeInvoiceId: deciding?.invoiceId ?? null,
    disputeStatus: deciding?.standing ?? null,
    // What withholds access is definite whatever else there is.
    incomplete: !deciding && unreadWithinHorizon,
    refundedInvoiceId,
  };
}
