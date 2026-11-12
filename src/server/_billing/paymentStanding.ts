import type Stripe from "stripe";

import { reportBillingError } from "./report";
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
  /** The subscription's latest invoice, when its payment was refunded in full. */
  refundedInvoiceId: string | null;
};

/** Charges read per page, and the most pages, newest first. */
const CHARGES_PAGE_SIZE = 100;
const MAX_CHARGE_PAGES = 3;
/** One page each: a payment has a handful of these at most. */
const LIST_LIMIT = 100;

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

/** All charges of a customer, newest first; null when there are more than are read. */
async function listCustomerCharges(stripe: Stripe, customerId: string): Promise<Stripe.Charge[] | null> {
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
    if (!list.has_more || !startingAfter) return charges;
    if (page >= MAX_CHARGE_PAGES) return null;
  }
}

type SubscriptionDispute = { created: number; id: string; invoiceId: string; standing: "open" | "lost" };

/** The open and lost disputes on charges that paid invoices of `subscriptionId`. */
async function disputesOfSubscription(
  stripe: Stripe,
  subscriptionId: string,
  charges: readonly Stripe.Charge[],
): Promise<SubscriptionDispute[]> {
  const found: SubscriptionDispute[] = [];
  for (const charge of charges) {
    if (!charge.disputed) continue;
    const paid = await findSubscriptionInvoice(stripe, stripeId(charge.payment_intent));
    if (paid?.subscriptionId !== subscriptionId) continue;
    const disputes = await stripe.disputes.list({ charge: charge.id, limit: LIST_LIMIT });
    for (const dispute of disputes.data) {
      const standing = disputeStanding(dispute.status);
      if (standing === "cleared") continue;
      found.push({ created: dispute.created, id: dispute.id, invoiceId: paid.invoiceId, standing });
    }
  }
  return found.sort((a, b) => b.created - a.created);
}

/**
 * The lost dispute that still leaves the subscription unpaid for, if any:
 * the one on the most recent PAID invoice. Once a later invoice is paid
 * (and not itself lost), an earlier loss no longer withholds anything.
 */
async function standingLoss(
  stripe: Stripe,
  subscriptionId: string,
  lost: readonly SubscriptionDispute[],
): Promise<SubscriptionDispute | null> {
  if (lost.length === 0) return null;
  // Newest first; the most recent paid invoice is on the first page.
  const invoices = await stripe.invoices.list({ limit: LIST_LIMIT, status: "paid", subscription: subscriptionId });
  const newestPaid = [...invoices.data].sort((a, b) => b.created - a.created)[0];
  if (!newestPaid) return lost[0] ?? null;
  return lost.find((dispute) => dispute.invoiceId === newestPaid.id) ?? null;
}

/** Whether every successful charge that paid `invoiceId` was refunded in full. */
async function isRefundedInFull(
  stripe: Stripe,
  invoiceId: string,
  charges: readonly Stripe.Charge[],
): Promise<boolean> {
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: LIST_LIMIT, status: "paid" });
  const paying = payments.data.flatMap((payment) => {
    const intent = stripeId(payment.payment.payment_intent);
    const direct = stripeId(payment.payment.charge);
    return charges.filter(
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
 * Reads the standing of `subscription` (as just read from Stripe, with
 * `latest_invoice` expanded) from Stripe. Returns null, having reported it,
 * when the customer has more charges than are read: a partial history must
 * not be stored as "nothing disputed", so the stored standing is left as
 * it is.
 */
export async function readPaymentStanding(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<PaymentStanding | null> {
  const customerId = stripeId(subscription.customer);
  if (!customerId) return null;

  const charges = await listCustomerCharges(stripe, customerId);
  if (!charges) {
    reportBillingError("Customer has more charges than are read: payment standing left as stored", {
      customerId,
      subscriptionId: subscription.id,
    });
    return null;
  }

  const disputes = await disputesOfSubscription(stripe, subscription.id, charges);
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

  return {
    disputeId: deciding?.id ?? null,
    disputeInvoiceId: deciding?.invoiceId ?? null,
    disputeStatus: deciding?.standing ?? null,
    refundedInvoiceId: refunded ? latestPaidInvoiceId : null,
  };
}
