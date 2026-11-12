import type Stripe from "stripe";

import { logger } from "~/_utils";
import {
  getPriceIdForCheckout,
  type BillingInterval,
  type PriceConfig,
} from "~/server/_utils/pricing";

import { isTerminalStatus } from "./entitlements";
import { reportBillingError } from "./report";
import { isStripeResourceMissing } from "./stripe";
import {
  linkCustomerToUser,
  syncSubscriptionById,
  syncUserFromStripe,
  type BillingDb,
} from "./subscriptionStore";

/**
 * Starting a subscription (Stripe Checkout) and managing one (the Stripe
 * billing portal).
 */

/**
 * Where Checkout may send the browser after payment. A fixed list: the
 * client picks one of these, it cannot supply a URL or a path of its own.
 */
export const CHECKOUT_SUCCESS_PATHS = [
  "/app/settings?checkout=success",
  "/app/onboarding/complete?plan=pro",
] as const;
export type CheckoutSuccessPath = (typeof CHECKOUT_SUCCESS_PATHS)[number];

const CHECKOUT_CANCEL_PATH = "/app/settings?checkout=canceled";
const PORTAL_RETURN_PATH = "/app/settings";

/** An absolute URL on the app's own configured origin. */
function appUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

type BillingUser = { email: string; id: string; role: string; stripeId: string | null };

function loadBillingUser(db: BillingDb, userId: string): Promise<BillingUser | null> {
  return db.user.findUnique({
    select: { email: true, id: true, role: true, stripeId: true },
    where: { id: userId },
  });
}

/**
 * The user's Stripe customer, created on first use and stored at once, so
 * that every later webhook can be matched to the user by customer id.
 *
 * `idempotencyKey` makes two simultaneous first checkouts (or a retry after
 * a lost response) get the SAME customer from Stripe instead of two.
 */
async function ensureCustomer(
  db: BillingDb,
  stripe: Stripe,
  user: BillingUser,
  idempotencyKey: string,
): Promise<string> {
  if (user.stripeId) return user.stripeId;

  const customer = await stripe.customers.create(
    { email: user.email, metadata: { userId: user.id } },
    { idempotencyKey },
  );

  const link = await linkCustomerToUser(db, user.id, customer.id);
  if (link !== "conflict") return customer.id;

  // A concurrent request stored a customer first; use that one.
  const current = await db.user.findUnique({ select: { stripeId: true }, where: { id: user.id } });
  if (current?.stripeId) return current.stripeId;
  throw new Error("Could not store the Stripe customer for the user");
}

/**
 * Brings the user's subscription row up to date with Stripe before a
 * decision is made on it, so that a missed webhook can neither let someone
 * buy a second subscription nor lock them out of buying one.
 */
export async function refreshBillingState(
  db: BillingDb,
  stripe: Stripe,
  userId: string,
): Promise<void> {
  const result = await syncUserFromStripe(db, stripe, userId);
  if (result.outcome !== "no_subscription" && result.outcome !== "no_customer") return;

  // Stripe lists nothing for the user's customer. A row that still claims a
  // running subscription is then either on another customer, or gone.
  const row = await db.subscription.findUnique({ where: { userId } });
  if (!row?.subscriptionId || isTerminalStatus(row.status)) return;

  const single = await syncSubscriptionById(db, stripe, row.subscriptionId);
  if (single.outcome === "subscription_missing") {
    reportBillingError("Subscription row points at a subscription Stripe does not have", {
      subscriptionId: row.subscriptionId,
      userId,
    });
  }
}

/** Open Checkout sessions looked at when starting a new one. */
const OPEN_SESSIONS_TO_EXPIRE = 10;

/**
 * Expires the customer's unfinished Checkout sessions. Each open session can
 * still be paid; leaving an older one open (a second tab, a double click)
 * is how a customer ends up with two subscriptions.
 */
async function expireOpenCheckoutSessions(stripe: Stripe, customerId: string): Promise<void> {
  const open = await stripe.checkout.sessions.list({
    customer: customerId,
    limit: OPEN_SESSIONS_TO_EXPIRE,
    status: "open",
  });
  for (const session of open.data) {
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch (error) {
      // It was completed or expired in the meantime. A completed one shows
      // up as a subscription in the refresh that follows.
      logger.info("Could not expire a Checkout session", { error, sessionId: session.id });
    }
  }
}

export type StartCheckoutInput = {
  baseUrl: string;
  billingInterval: BillingInterval;
  prices?: PriceConfig;
  successPath: CheckoutSuccessPath;
  userId: string;
};

export type StartCheckoutResult =
  | { kind: "url"; sessionId: string; url: string }
  /** Already subscribed (or comped): manage it in the portal instead. */
  | { kind: "subscription_exists" }
  | { kind: "user_not_found" };

/**
 * Creates a Checkout session for the Pro plan at the price the user's role
 * entitles them to. Throws PriceNotConfiguredError when that price has no
 * Stripe Price id configured, and Stripe's errors when Stripe fails.
 */
export async function startCheckout(
  db: BillingDb,
  stripe: Stripe,
  input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
  const user = await loadBillingUser(db, input.userId);
  if (!user) return { kind: "user_not_found" };

  // Before anything is created at Stripe: a misconfigured plan fails here.
  const priceId = getPriceIdForCheckout(user.role, input.billingInterval, input.prices);

  let customerId = await ensureCustomer(db, stripe, user, `my-iso:customer:${user.id}`);

  const createSession = async (customer: string) => {
    await expireOpenCheckoutSessions(stripe, customer);
    await refreshBillingState(db, stripe, user.id);

    const row = await db.subscription.findUnique({ where: { userId: user.id } });
    if (row && (row.isLifetime || !isTerminalStatus(row.status))) return null;

    return stripe.checkout.sessions.create({
      cancel_url: appUrl(input.baseUrl, CHECKOUT_CANCEL_PATH),
      client_reference_id: user.id,
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      // The user id travels on the session and on the subscription it
      // creates, so webhooks can be matched to the user without the email.
      metadata: { userId: user.id },
      mode: "subscription",
      subscription_data: { metadata: { userId: user.id } },
      success_url: appUrl(input.baseUrl, input.successPath),
    });
  };

  let session: Stripe.Checkout.Session | null;
  try {
    session = await createSession(customerId);
  } catch (error) {
    if (!isStripeResourceMissing(error, "customer")) throw error;
    // The stored customer no longer exists at Stripe (deleted in the
    // dashboard before the webhook arrived). Start over with a new one.
    await db.user.updateMany({ data: { stripeId: null }, where: { id: user.id, stripeId: customerId } });
    customerId = await ensureCustomer(
      db,
      stripe,
      { ...user, stripeId: null },
      `my-iso:customer:${user.id}:after:${customerId}`,
    );
    session = await createSession(customerId);
  }

  if (!session) return { kind: "subscription_exists" };
  if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
  return { kind: "url", sessionId: session.id, url: session.url };
}

export type OpenPortalResult =
  | { kind: "url"; url: string }
  /** The user has never been a Stripe customer: there is nothing to manage. */
  | { kind: "no_billing_account" };

/** Creates a billing-portal session for the user's Stripe customer. */
export async function openBillingPortal(
  db: BillingDb,
  stripe: Stripe,
  input: { baseUrl: string; userId: string },
): Promise<OpenPortalResult> {
  const [user, row] = await Promise.all([
    loadBillingUser(db, input.userId),
    db.subscription.findUnique({ where: { userId: input.userId } }),
  ]);
  // The customer the running subscription is on, else the stored one.
  const customerId =
    (row && !isTerminalStatus(row.status) ? row.stripeCustomerId : null) ?? user?.stripeId ?? null;
  if (!customerId) return { kind: "no_billing_account" };

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: appUrl(input.baseUrl, PORTAL_RETURN_PATH),
    });
    return { kind: "url", url: session.url };
  } catch (error) {
    if (isStripeResourceMissing(error)) return { kind: "no_billing_account" };
    throw error;
  }
}
