import Stripe from "stripe";

import { logger } from "~/_utils";

import {
  claimStripeEvent,
  completeStripeEvent,
  releaseStripeEvent,
  type EventLogDb,
} from "./eventLog";
import { reportBillingError } from "./report";
import { constructWebhookEvent, isStripeResourceMissing, isWebhookSecretConfigured } from "./stripe";
import { disputeStanding, stripeId } from "./subscriptionState";
import {
  forgetDeletedCustomer,
  linkCustomerToUser,
  recordDispute,
  recordRefund,
  syncSubscriptionById,
  type BillingDb,
  type SubscriptionSyncResult,
  type SyncOptions,
} from "./subscriptionStore";

/**
 * The Stripe webhook, independent of Next.js so that it runs against a real
 * database in tests. `src/app/webhooks/stripe/route.ts` is the HTTP shell.
 *
 * What Stripe is told:
 *
 * - 400: the signature is missing or wrong (or the delivery is a replay
 *   older than the tolerance). Nothing was read from the body.
 * - 413: the body is larger than any event Stripe sends (the HTTP shell,
 *   ./webhookRequest.ts, refuses it before or while reading).
 * - 200: handled, a duplicate of an event already handled, an event type
 *   this app has no use for, or an event about a customer/subscription that
 *   does not belong to a user here (logged; retrying could never help).
 * - 409: the same event is being handled by another delivery right now.
 *   Stripe retries, and the retry finds it handled.
 * - 500: something transient failed (database, Stripe API), or this server
 *   has no webhook signing secret configured. Stripe retries with back-off
 *   for up to three days; every handler is idempotent.
 *
 * Event order is not trusted: an event only says WHICH subscription
 * changed. Its state is then read from the Stripe API and stored under the
 * guards in subscriptionStore.ts, so events can arrive late, twice, or in
 * any order and the row still ends up as Stripe has it.
 *
 * Events the endpoint must be subscribed to (others are acknowledged and
 * ignored): see HANDLED_EVENT_TYPES. The endpoint's API version must be
 * STRIPE_API_VERSION (see ./stripe.ts).
 */

export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.refunded",
  "customer.deleted",
] as const satisfies ReadonlyArray<Stripe.Event["type"]>;

type HandledEvent = Extract<Stripe.Event, { type: (typeof HANDLED_EVENT_TYPES)[number] }>;

function isHandledEvent(event: Stripe.Event): event is HandledEvent {
  return HANDLED_EVENT_TYPES.some((type) => type === event.type);
}

export type WebhookDb = BillingDb & EventLogDb;

export type WebhookDeps = {
  db: WebhookDb;
  /** Called only when an event needs the API (lazy: see getStripe). */
  getStripe: () => Stripe;
  /** Whether a signing secret is configured. Defaults to the environment's. */
  secretConfigured?: () => boolean;
  /** How a same-second tie between two readings is waited out; for tests. */
  sync?: SyncOptions;
  /** Verifies the signature and parses the event. Defaults to the configured secret. */
  verify?: (rawBody: string, signature: string) => Promise<Stripe.Event>;
};

export type WebhookResponse = { body: string; status: 200 | 400 | 409 | 413 | 500 };

/** What handling an event came to, for the log and the response body. */
type Outcome =
  | "applied"
  | "stale"
  | "subscription_missing"
  | "unknown_customer"
  | "not_a_subscription"
  | "dispute_recorded"
  | "refund_recorded"
  /** The dispute or charge the event names no longer exists at Stripe. */
  | "object_missing"
  | "customer_forgotten";

const respond = (status: WebhookResponse["status"], result: string): WebhookResponse => ({
  body: JSON.stringify({ result }),
  status,
});

/** Stores the current state of the subscription an event is about. */
async function syncFromEvent(
  deps: WebhookDeps,
  event: HandledEvent,
  subscriptionId: string | null,
  hintUserId: string | null = null,
): Promise<Outcome> {
  if (!subscriptionId) return "not_a_subscription";

  const result: SubscriptionSyncResult = await syncSubscriptionById(
    deps.db,
    deps.getStripe(),
    subscriptionId,
    hintUserId,
    deps.sync,
  );

  if (result.outcome === "unknown_customer") {
    // Acknowledged, not retried: no retry can make this customer a user.
    // Typically another product on the same Stripe account, or test data.
    reportBillingError("Stripe event for a customer that is not a user of this app", {
      customerId: result.customerId,
      eventId: event.id,
      eventType: event.type,
      subscriptionId,
    });
  } else if (result.outcome === "subscription_missing") {
    logger.warn("Stripe event for a subscription that no longer exists", {
      eventId: event.id,
      eventType: event.type,
      subscriptionId,
    });
  }
  return result.outcome;
}

/** Invoice payments looked at when tracing a payment back to its invoice. */
const INVOICE_PAYMENTS_CONSIDERED = 10;

/**
 * The subscription invoice a payment paid, if it paid one.
 *
 * In this API version neither a charge nor a payment intent points at an
 * invoice: the link is the InvoicePayment object, listed by payment intent.
 * The invoice then names its subscription through `parent`.
 */
async function findSubscriptionInvoice(
  stripe: Stripe,
  paymentIntentId: string | null,
): Promise<{ invoiceId: string; subscriptionId: string } | null> {
  if (!paymentIntentId) return null;
  const payments = await stripe.invoicePayments.list({
    expand: ["data.invoice"],
    limit: INVOICE_PAYMENTS_CONSIDERED,
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

/**
 * A dispute was opened, changed or closed. Only its id is taken from the
 * event; what it means is read from the dispute as Stripe has it now
 * (disputeStanding), so `created` arriving after `closed` records the
 * closed state. An open dispute suspends access to the subscription whose
 * invoice the charge paid; a won one restores it; a lost one leaves the
 * period it paid for unpaid (entitlements.ts).
 */
async function handleDispute(deps: WebhookDeps, event: HandledEvent, disputeId: string): Promise<Outcome> {
  const stripe = deps.getStripe();
  let dispute: Stripe.Dispute;
  try {
    dispute = await stripe.disputes.retrieve(disputeId);
  } catch (error) {
    if (isStripeResourceMissing(error)) return "object_missing";
    throw error;
  }

  const invoice = await findSubscriptionInvoice(stripe, stripeId(dispute.payment_intent));
  if (!invoice) return "not_a_subscription";

  // The row first (it may not exist yet, or lag), then the marker on it.
  const synced = await syncFromEvent(deps, event, invoice.subscriptionId);
  if (synced !== "applied" && synced !== "stale") return synced;

  const standing = disputeStanding(dispute.status);
  const recorded = await recordDispute(deps.db, invoice.subscriptionId, {
    id: dispute.id,
    invoiceId: invoice.invoiceId,
    standing,
  });
  if (standing !== "cleared") {
    reportBillingError("Dispute on a subscription payment", {
      disputeId: dispute.id,
      disputeStatus: dispute.status,
      eventId: event.id,
      standing,
      subscriptionId: invoice.subscriptionId,
    });
  }
  // Not recorded: the user's row shows another subscription of theirs.
  return recorded ? "dispute_recorded" : "stale";
}

/**
 * A charge was refunded (in part or in full). Whether it is fully refunded
 * is read from the charge as Stripe has it now; a full refund of the
 * payment of a subscription invoice is recorded on the row, a partial one
 * (or a refund that was reversed) clears that marker.
 */
async function handleRefund(deps: WebhookDeps, event: HandledEvent, chargeId: string): Promise<Outcome> {
  const stripe = deps.getStripe();
  let charge: Stripe.Charge;
  try {
    charge = await stripe.charges.retrieve(chargeId);
  } catch (error) {
    if (isStripeResourceMissing(error)) return "object_missing";
    throw error;
  }

  const invoice = await findSubscriptionInvoice(stripe, stripeId(charge.payment_intent));
  if (!invoice) return "not_a_subscription";

  const synced = await syncFromEvent(deps, event, invoice.subscriptionId);
  if (synced !== "applied" && synced !== "stale") return synced;

  const recorded = await recordRefund(deps.db, invoice.subscriptionId, {
    fullyRefunded: charge.refunded,
    invoiceId: invoice.invoiceId,
  });
  logger.info("Refund on a subscription payment", {
    chargeId: charge.id,
    eventId: event.id,
    fullyRefunded: charge.refunded,
    subscriptionId: invoice.subscriptionId,
  });
  return recorded ? "refund_recorded" : "stale";
}

async function handleEvent(deps: WebhookDeps, event: HandledEvent): Promise<Outcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object;
      if (session.mode !== "subscription") return "not_a_subscription";

      // The session was created by this server for a signed-in user, with
      // their id as the reference. Their customer id is normally stored
      // already (checkout creates the customer first); make sure of it.
      const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
      const customerId = stripeId(session.customer);
      if (userId && customerId) {
        const user = await deps.db.user.findUnique({ select: { id: true }, where: { id: userId } });
        if (user) {
          const link = await linkCustomerToUser(deps.db, user.id, customerId);
          if (link === "conflict") {
            reportBillingError("Checkout completed with a customer other than the user's stored one", {
              customerId,
              eventId: event.id,
              sessionId: session.id,
              userId,
            });
          }
        }
      }
      return syncFromEvent(deps, event, stripeId(session.subscription), userId);
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      // Only the id is taken from the event; the state is read from Stripe.
      return syncFromEvent(deps, event, event.data.object.id);

    case "invoice.paid":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      // The subscription itself says what a paid or failed invoice means:
      // `active` again after a recovery, `past_due` while Stripe retries,
      // `canceled`/`unpaid` once it has given up. A failed invoice does
      // not, on its own, end anyone's access.
      const invoice = event.data.object;
      // Since API version 2025-03-31 an invoice points at its subscription
      // through `parent`, no longer through `invoice.subscription`.
      const subscriptionId = stripeId(invoice.parent?.subscription_details?.subscription);
      const outcome = await syncFromEvent(deps, event, subscriptionId);
      if (event.type === "invoice.payment_failed" && subscriptionId) {
        logger.warn("Subscription payment failed", {
          attemptCount: invoice.attempt_count,
          eventId: event.id,
          invoiceId: invoice.id,
          subscriptionId,
        });
      }
      return outcome;
    }

    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
      return handleDispute(deps, event, event.data.object.id);

    case "charge.refunded":
      return handleRefund(deps, event, event.data.object.id);

    case "customer.deleted": {
      const result = await forgetDeletedCustomer(
        deps.db,
        event.data.object.id,
        new Date(event.created * 1000),
      );
      logger.info("Stripe customer deleted", { customerId: event.data.object.id, ...result });
      return "customer_forgotten";
    }
  }
}

let missingSecretReported = false;

/** Once per isolate: every delivery would otherwise repeat it. */
function reportMissingSecretOnce(): void {
  if (missingSecretReported) return;
  missingSecretReported = true;
  reportBillingError("STRIPE_WEBHOOK_SECRET is not set: Stripe webhooks are answered with 500 until it is");
}

/**
 * Handles one webhook delivery. `rawBody` must be the request body exactly
 * as received (the signature covers the bytes, not the parsed JSON).
 */
export async function handleStripeWebhook(
  deps: WebhookDeps,
  rawBody: string,
  signature: string | null,
): Promise<WebhookResponse> {
  if (!signature) {
    logger.warn("Stripe webhook rejected: missing signature header");
    return respond(400, "missing_signature");
  }

  // A server without a signing secret cannot tell Stripe's deliveries from
  // forgeries. That is this server's fault, not the sender's: 500, so that
  // Stripe keeps the events and redelivers them once it is fixed.
  if (!(deps.secretConfigured ?? isWebhookSecretConfigured)()) {
    reportMissingSecretOnce();
    return respond(500, "webhook_secret_missing");
  }

  let event: Stripe.Event;
  try {
    event = await (deps.verify ?? constructWebhookEvent)(rawBody, signature);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
      logger.warn("Stripe webhook rejected: signature verification failed", {
        error: error.message,
      });
      return respond(400, "invalid_signature");
    }
    // Not a bad signature: verification itself could not run (for example
    // the signing secret is missing). Let Stripe retry while it is fixed.
    reportBillingError("Stripe webhook could not be verified", { error });
    return respond(500, "verification_unavailable");
  }

  if (!isHandledEvent(event)) {
    return respond(200, "ignored");
  }

  let claim: Awaited<ReturnType<typeof claimStripeEvent>>;
  try {
    claim = await claimStripeEvent(deps.db, event);
  } catch (error) {
    reportBillingError("Stripe webhook: could not record the event", {
      error,
      eventId: event.id,
      eventType: event.type,
    });
    return respond(500, "error");
  }
  if (claim.status === "duplicate") {
    logger.info("Stripe webhook: duplicate delivery ignored", {
      eventId: event.id,
      eventType: event.type,
    });
    return respond(200, "duplicate");
  }
  if (claim.status === "in_progress") {
    return respond(409, "in_progress");
  }

  try {
    const outcome = await handleEvent(deps, event);
    await completeStripeEvent(deps.db, event.id, claim.claimedAt);
    logger.info("Stripe webhook handled", {
      eventId: event.id,
      eventType: event.type,
      outcome,
    });
    return respond(200, outcome);
  } catch (error) {
    reportBillingError("Stripe webhook: handling failed, Stripe will retry", {
      error,
      eventId: event.id,
      eventType: event.type,
    });
    // Free the claim so that the retry is not mistaken for a duplicate. If
    // this fails too, the claim expires on its own (CLAIM_LEASE_SECONDS).
    await releaseStripeEvent(deps.db, event.id, claim.claimedAt).catch((releaseError: unknown) => {
      logger.warn("Stripe webhook: could not release the event claim", {
        error: releaseError,
        eventId: event.id,
      });
    });
    return respond(500, "error");
  }
}
