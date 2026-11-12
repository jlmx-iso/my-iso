import type Stripe from "stripe";

import { isStripeResourceMissing } from "./stripe";
import { disputeStanding, stripeId } from "./subscriptionState";

/**
 * What the disputes and refunds on a subscription's payments mean for
 * access, DERIVED from what Stripe has now.
 *
 * No STATE is taken from webhook events. A dispute or refund event only
 * says that the standing of some subscription may have changed; the
 * standing is then computed from what Stripe has at that moment and stored
 * whole (subscriptionStore.storePaymentStanding, under the customer's
 * lease). So events may arrive late, twice or out of order, and a refund
 * that failed is simply no longer a refund.
 *
 * What IS remembered is which disputes exist: every dispute this app has
 * ever learned of, from an event or from a listing, is kept in the table
 * SubscriptionDispute, and one that is not finished is re-read from Stripe
 * BY ITS ID in every derivation. A dispute leaves that set only on a direct
 * read that says it is over. The charge listing is bounded, so without the
 * set a derivation could fail to see a dispute on an old charge and "find"
 * that nothing is withheld; with it, what a derivation cannot see in the
 * listing it still reads. The standing is the worst across all of them.
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
/**
 * Known disputes that are not finished and are re-read by id in one
 * derivation. More than this (which no real customer has) fails closed:
 * the ones not re-read keep their stored status, so an open one still
 * withholds, and the row is reported.
 */
export const MAX_KNOWN_DISPUTES_REREAD = 10;

/** Payments of the latest invoice whose charge is read directly when the listing does not hold it. */
const MAX_UNLISTED_PAYMENTS_READ = 2;

/**
 * The most Stripe requests one derivation makes: the charge pages, the
 * charge an event is about, two per disputed charge examined, the known
 * disputes re-read by id, the invoices of the subscription, the payments of
 * its latest invoice, and those payments' charges where unlisted.
 */
export const MAX_STANDING_STRIPE_CALLS =
  MAX_CHARGE_PAGES + 1 + 2 * MAX_DISPUTED_CHARGES + MAX_KNOWN_DISPUTES_REREAD + 2 + MAX_UNLISTED_PAYMENTS_READ;

/**
 * A dispute as SubscriptionDispute keeps it.
 *
 * - "open": a chargeback in progress. Withholds access.
 * - "inquiry": no money taken (yet); withholds nothing, but it can become a
 *   chargeback, so it is not finished.
 * - "lost": the payment was taken back. Withholds access while its invoice
 *   is the most recent one paid for. Final at Stripe, so it is not re-read;
 *   it is kept until superseded.
 * - "superseded": lost, and a later invoice has been paid for. Finished.
 * - "cleared": won, withdrawn, closed as an inquiry, or gone. Finished.
 * - "unexamined": not a dispute but a MARKER (one row per subscription,
 *   see unexaminedMarkerId): a derivation found disputes it could not
 *   examine within its bounds. It withholds access like an open dispute,
 *   and only a derivation that examined everything, on a charge history
 *   read whole, turns it into "cleared". An incomplete derivation, which
 *   may simply no longer see those charges, never does.
 */
export type KnownDisputeStatus = "open" | "inquiry" | "lost" | "superseded" | "cleared" | "unexamined";
export type KnownDispute = { disputeId: string; invoiceId: string; status: KnownDisputeStatus };

/** The id of a subscription's "unexamined" marker row in SubscriptionDispute. */
export const unexaminedMarkerId = (subscriptionId: string): string => `unexamined:${subscriptionId}`;

/** Statuses a derivation still has to look at: not finished. */
export const UNFINISHED_DISPUTE_STATUSES = ["open", "inquiry", "unexamined", "lost"] as const satisfies readonly KnownDisputeStatus[];

function knownStatusOf(stripeStatus: string): KnownDisputeStatus {
  if (stripeStatus === "warning_needs_response" || stripeStatus === "warning_under_review") return "inquiry";
  const standing = disputeStanding(stripeStatus);
  return standing === "cleared" ? "cleared" : standing;
}

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

type Sighting = KnownDispute & { created: number };

/**
 * Every dispute (whatever its status) on charges that paid invoices of
 * `subscriptionId`, from MAX_DISPUTED_CHARGES disputed charges: first the
 * ones an event is about (`focus`, whatever their age), then the newest
 * within the horizon. `unexamined`: there were more than that.
 */
async function disputesOnCharges(
  stripe: Stripe,
  subscriptionId: string,
  charges: readonly Stripe.Charge[],
  focus: readonly Stripe.Charge[],
  nowSeconds: number,
): Promise<{ sightings: Sighting[]; unexamined: boolean }> {
  const focusIds = new Set(focus.map((charge) => charge.id));
  const disputed = [
    ...focus.filter((charge) => charge.disputed),
    ...charges
      .filter((charge) => !focusIds.has(charge.id))
      .filter((charge) => charge.disputed && charge.created >= nowSeconds - DISPUTE_HORIZON_SECONDS)
      .sort((a, b) => b.created - a.created),
  ];
  const sightings: Sighting[] = [];
  for (const charge of disputed.slice(0, MAX_DISPUTED_CHARGES)) {
    const paid = await findSubscriptionInvoice(stripe, stripeId(charge.payment_intent));
    if (paid?.subscriptionId !== subscriptionId) continue;
    const disputes = await stripe.disputes.list({ charge: charge.id, limit: LIST_LIMIT });
    for (const dispute of disputes.data) {
      sightings.push({
        created: dispute.created,
        disputeId: dispute.id,
        invoiceId: paid.invoiceId,
        status: knownStatusOf(dispute.status),
      });
    }
  }
  return { sightings, unexamined: disputed.length > MAX_DISPUTED_CHARGES };
}

/**
 * The known disputes that were not seen on the charges just examined, as
 * they are now. One that may still change ("open", "inquiry") is re-read
 * from Stripe by its id, up to MAX_KNOWN_DISPUTES_REREAD of them; a "lost"
 * one is final and is carried as it is. `overflow`: some could not be
 * re-read and keep their stored status.
 */
async function knownDisputesNow(
  stripe: Stripe,
  known: readonly KnownDispute[],
  seen: ReadonlySet<string>,
): Promise<{ overflow: boolean; sightings: Sighting[] }> {
  const sightings: Sighting[] = [];
  let reads = 0;
  let overflow = false;
  for (const dispute of known) {
    if (seen.has(dispute.disputeId)) continue;
    if (dispute.status !== "open" && dispute.status !== "inquiry") {
      sightings.push({ ...dispute, created: 0 });
      continue;
    }
    if (reads >= MAX_KNOWN_DISPUTES_REREAD) {
      overflow = true;
      sightings.push({ ...dispute, created: 0 });
      continue;
    }
    reads += 1;
    try {
      const current = await stripe.disputes.retrieve(dispute.disputeId);
      sightings.push({ ...dispute, created: current.created, status: knownStatusOf(current.status) });
    } catch (error) {
      if (!isStripeResourceMissing(error)) throw error;
      // Stripe has no such dispute any more: it withholds nothing.
      sightings.push({ ...dispute, created: 0, status: "cleared" });
    }
  }
  return { overflow, sightings };
}

/**
 * The most recent invoice of the subscription that was actually PAID FOR,
 * or null. An invoice that is `paid` without money having changed hands (a
 * trial, a credit, a proration that came to nothing) is not a payment.
 */
async function newestInvoicePaidFor(stripe: Stripe, subscriptionId: string): Promise<string | null> {
  // Newest first; the most recent paid invoice is on the first page.
  const invoices = await stripe.invoices.list({ limit: LIST_LIMIT, status: "paid", subscription: subscriptionId });
  return (
    invoices.data.filter((invoice) => invoice.amount_paid > 0).sort((a, b) => b.created - a.created)[0]?.id ?? null
  );
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

/** What a derivation found: the standing, and every dispute it knows of, to be remembered. */
export type StandingReading = { disputes: KnownDispute[]; standing: PaymentStanding };

/**
 * Reads the standing of `subscription` (as just read from Stripe, with
 * `latest_invoice` expanded) from Stripe, in at most
 * MAX_STANDING_STRIPE_CALLS requests. Null only when the subscription has
 * no customer.
 *
 * `known`: the unfinished disputes SubscriptionDispute holds for this
 * subscription. They are part of every derivation (see the top of this
 * file), so a dispute stops withholding access only when it has itself
 * been read as over, or, for a lost one, when a later invoice has been
 * paid for. Finding nothing in the charge listing never clears one.
 *
 * `paymentIntentId`: the payment a dispute or refund event is about. Its
 * charges are read directly, by payment intent, so a dispute the app has
 * not met before is learned from its own event however old the charge.
 *
 * The standing is the worst across everything found: any dispute open is
 * "open"; otherwise a dispute lost on the most recent invoice paid for is
 * "lost"; otherwise nothing is withheld.
 *
 * The work is bounded, and no bound restores access:
 *
 * - More charges than are read (MAX_CHARGE_PAGES pages): the newest, the
 *   event's own, and every known dispute are still read. If charges within
 *   the dispute horizon were left unread and nothing withholds access, the
 *   result is `incomplete` (a dispute the app has never been told of, on
 *   one of those, would not be seen) and the row is reported for review.
 * - More disputed charges than are examined (MAX_DISPUTED_CHARGES), or more
 *   known disputes than are re-read (MAX_KNOWN_DISPUTES_REREAD) or even
 *   loaded (`knownTruncated`): FAIL CLOSED. If nothing examined withholds
 *   access the standing is "open" with no dispute named, and `incomplete`,
 *   and an "unexamined" marker is remembered for the subscription. That
 *   hold is lifted only by a derivation that examined everything on a
 *   history read whole (which happens by itself once the disputed charges
 *   are older than the horizon), never by one that merely no longer sees
 *   those charges. A customer like that needs a person; a comped account
 *   (`isLifetime`) is the override.
 */
export async function readPaymentStanding(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  options: {
    known?: readonly KnownDispute[];
    /** `known` is not the whole set: the subscription has more unfinished disputes than are read. */
    knownTruncated?: boolean;
    nowMs?: number;
    paymentIntentId?: string | null;
  } = {},
): Promise<StandingReading | null> {
  const customerId = stripeId(subscription.customer);
  if (!customerId) return null;
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);

  const { charges: listed, truncated } = await listCustomerCharges(stripe, customerId);
  const focus = options.paymentIntentId
    ? (await stripe.charges.list({ limit: LIST_LIMIT, payment_intent: options.paymentIntentId })).data
    : [];
  const listedIds = new Set(listed.map((charge) => charge.id));
  const charges = [...listed, ...focus.filter((charge) => !listedIds.has(charge.id))];

  const onCharges = await disputesOnCharges(stripe, subscription.id, listed, focus, nowSeconds);
  const remembered = await knownDisputesNow(
    stripe,
    options.known ?? [],
    new Set(onCharges.sightings.map((dispute) => dispute.disputeId)),
  );
  const all = [...onCharges.sightings, ...remembered.sightings].sort((a, b) => b.created - a.created);

  // A lost dispute withholds only while its invoice is the last one paid for.
  const lost = all.filter((dispute) => dispute.status === "lost");
  const lastPaidFor = lost.length > 0 ? await newestInvoicePaidFor(stripe, subscription.id) : null;
  for (const dispute of lost) {
    if (lastPaidFor !== null && dispute.invoiceId !== lastPaidFor) dispute.status = "superseded";
  }
  const deciding =
    all.find((dispute) => dispute.status === "open") ?? all.find((dispute) => dispute.status === "lost") ?? null;

  const invoice = subscription.latest_invoice;
  const latestPaidInvoiceId = invoice && typeof invoice !== "string" && invoice.status === "paid" ? invoice.id : null;
  const refunded = latestPaidInvoiceId !== null && (await isRefundedInFull(stripe, latestPaidInvoiceId, charges));
  const refundedInvoiceId = refunded ? latestPaidInvoiceId : null;

  // Unread charges that are recent enough to carry a live dispute.
  const oldestRead = listed.at(-1);
  const unreadWithinHorizon =
    truncated && oldestRead !== undefined && oldestRead.created >= nowSeconds - DISPUTE_HORIZON_SECONDS;

  // The "unexamined" marker: set when this derivation found disputed
  // charges it could not examine (nothing else records those disputes);
  // kept while it is set and the charge history was not read whole (they
  // may simply have dropped out of the listing); cleared only by a
  // derivation that examined every disputed charge on a history read whole.
  // Known disputes that could not all be re-read or loaded need no marker:
  // they stay in the set themselves, and fail this derivation closed.
  const markerId = unexaminedMarkerId(subscription.id);
  const marker = all.find((dispute) => dispute.disputeId === markerId);
  const held = onCharges.unexamined || (marker?.status === "unexamined" && unreadWithinHorizon);
  if (marker) marker.status = held ? "unexamined" : "cleared";
  const disputes: KnownDispute[] = [
    ...all.map(({ disputeId, invoiceId, status }) => ({ disputeId, invoiceId, status })),
    ...(!marker && held ? [{ disputeId: markerId, invoiceId: "", status: "unexamined" as const }] : []),
  ];
  const knownNotAllRead = remembered.overflow || options.knownTruncated === true;
  const notAllExamined = held || knownNotAllRead;

  if (!deciding && notAllExamined) {
    return {
      disputes,
      standing: { disputeId: null, disputeInvoiceId: null, disputeStatus: "open", incomplete: true, refundedInvoiceId },
    };
  }

  return {
    disputes,
    standing: {
      disputeId: deciding?.disputeId ?? null,
      disputeInvoiceId: deciding?.invoiceId ?? null,
      disputeStatus: deciding?.status === "open" || deciding?.status === "lost" ? deciding.status : null,
      // What withholds access is definite whatever else there is.
      incomplete: notAllExamined || (!deciding && unreadWithinHorizon),
      refundedInvoiceId,
    },
  };
}
