import Stripe from "stripe";

import { logger } from "~/_utils";

import {
  claimStripeEvent,
  completeStripeEvent,
  releaseStripeEvent,
  type EventLogDb,
} from "./eventLog";
import { reportBillingError } from "./report";
import { constructWebhookEvent } from "./stripe";
import { stripeId } from "./subscriptionState";
import {
  forgetDeletedCustomer,
  linkCustomerToUser,
  syncSubscriptionById,
  type BillingDb,
  type SubscriptionSyncResult,
} from "./subscriptionStore";

/**
 * The Stripe webhook, independent of Next.js so that it runs against a real
 * database in tests. `src/app/webhooks/stripe/route.ts` is the HTTP shell.
 *
 * What Stripe is told:
 *
 * - 400: the signature is missing or wrong (or the delivery is a replay
 *   older than the tolerance). Nothing was read from the body.
 * - 200: handled, a duplicate of an event already handled, an event type
 *   this app has no use for, or an event about a customer/subscription that
 *   does not belong to a user here (logged; retrying could never help).
 * - 409: the same event is being handled by another delivery right now.
 *   Stripe retries, and the retry finds it handled.
 * - 500: something transient failed (database, Stripe API). Stripe retries
 *   with back-off for up to three days; every handler is idempotent.
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
  /** Verifies the signature and parses the event. Defaults to the configured secret. */
  verify?: (rawBody: string, signature: string) => Promise<Stripe.Event>;
};

export type WebhookResponse = { body: string; status: 200 | 400 | 409 | 500 };

/** What handling an event came to, for the log and the response body. */
type Outcome =
  | "applied"
  | "stale"
  | "subscription_missing"
  | "unknown_customer"
  | "not_a_subscription"
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
