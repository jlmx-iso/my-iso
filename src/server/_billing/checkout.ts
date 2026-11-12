import type Stripe from "stripe";

import { logger } from "~/_utils";
import {
  getPriceIdForCheckout,
  type BillingInterval,
  type PriceConfig,
} from "~/server/_utils/pricing";

import { isTerminalStatus } from "./entitlements";
import { LeaseLostError, withLease, type LeaseDb, type LeaseHandle, type LeaseOptions } from "./lease";
import { reportBillingError } from "./report";
import { isStripeResourceMissing } from "./stripe";
import {
  linkCustomerToUser,
  syncSubscriptionById,
  syncUserFromStripe,
  type BillingDb,
  type SyncOptions,
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

export type RefreshOutcome =
  | "applied"
  | "stale"
  /** Stripe has nothing for the user (no customer, or no subscription). */
  | "nothing_at_stripe"
  /** The row's subscription is not the user's customer's: left as it is. */
  | "unknown_customer"
  /** The row points at a subscription Stripe does not have. */
  | "subscription_missing"
  /**
   * The customer has more subscriptions than are read: nothing was stored
   * and nothing is known. Whoever decides on this must fail closed.
   */
  | "listing_truncated";

/**
 * Brings the user's subscription row up to date with Stripe before a
 * decision is made on it, so that a missed webhook can neither let someone
 * buy a second subscription nor lock them out of buying one.
 *
 * `hasLiveSubscription`: Stripe has a subscription for the user's customer
 * that has not ended, whichever one the row ends up showing.
 */
export async function refreshBillingState(
  db: BillingDb,
  stripe: Stripe,
  userId: string,
  options: SyncOptions = {},
): Promise<{ hasLiveSubscription: boolean; outcome: RefreshOutcome }> {
  const result = await syncUserFromStripe(db, stripe, userId, options);
  if ("state" in result) {
    return { hasLiveSubscription: result.hasLiveSubscription, outcome: result.outcome };
  }
  if (result.outcome === "listing_truncated") {
    // Unknown, and reported. "Live" is the answer that cannot lead to a
    // second subscription; startCheckout refuses on the outcome itself.
    return { hasLiveSubscription: true, outcome: "listing_truncated" };
  }

  // Stripe lists nothing for the user's customer. A row that still claims a
  // running subscription is then either on another customer, or gone.
  const row = await db.subscription.findUnique({ where: { userId } });
  if (!row?.subscriptionId || isTerminalStatus(row.status)) {
    return { hasLiveSubscription: false, outcome: "nothing_at_stripe" };
  }

  const single = await syncSubscriptionById(db, stripe, row.subscriptionId, null, options);
  if (single.outcome === "subscription_missing") {
    reportBillingError("Subscription row points at a subscription Stripe does not have", {
      subscriptionId: row.subscriptionId,
      userId,
    });
    return { hasLiveSubscription: false, outcome: "subscription_missing" };
  }
  if (single.outcome === "unknown_customer") {
    return { hasLiveSubscription: false, outcome: "unknown_customer" };
  }
  return { hasLiveSubscription: !isTerminalStatus(single.state.status), outcome: single.outcome };
}

/** Open Checkout sessions read per page, and the most pages, when starting a new one. */
const OPEN_SESSIONS_PAGE_SIZE = 100;
const MAX_OPEN_SESSION_PAGES = 10;

/**
 * The billing state could not be established (see "listing_truncated"), or
 * the customer has more open Checkout sessions than can be reviewed.
 * Nothing was created.
 */
export class BillingStateUnknownError extends Error {
  constructor(what: string) {
    super(`Checkout refused: ${what}`);
    this.name = "BillingStateUnknownError";
  }
}

/** An open session is handed out again only if it stays payable this long. */
const REUSE_MIN_REMAINING_MS = 30 * 60 * 1000;

/**
 * The lease that makes starting Checkout run for one user at a time: held
 * for at most CHECKOUT_LEASE_SECONDS, waited for up to
 * CHECKOUT_LEASE_WAIT_MS by a second request, which then finds the first
 * one's session open and reuses it.
 *
 * The sequence has no fixed length (every open session is closed, each
 * Stripe call may be retried), so it is not assumed to fit in the TTL: the
 * lease is RENEWED immediately before the session is created, which fails
 * if another request has taken it over in the meantime. A request that ran
 * past its lease therefore stops without creating anything, and the one
 * call that follows a successful renewal (create, at most three attempts
 * of 15 s) fits in a fresh TTL.
 */
const CHECKOUT_LEASE_SECONDS = 120;
const CHECKOUT_LEASE_WAIT_MS = 10_000;

type SessionRequest = {
  customerId: string;
  priceId: string;
  successUrl: string;
  userId: string;
};

/** An open session this server created for exactly this purchase. */
function isReusable(session: Stripe.Checkout.Session, request: SessionRequest, nowMs: number): boolean {
  return (
    session.status === "open" &&
    session.mode === "subscription" &&
    session.url !== null &&
    session.metadata?.userId === request.userId &&
    session.metadata?.priceId === request.priceId &&
    session.success_url === request.successUrl &&
    session.expires_at * 1000 - nowMs > REUSE_MIN_REMAINING_MS
  );
}

/**
 * Expires a session, or makes sure it can no longer be paid. If the expire
 * call fails, the session is read back: only one that is confirmed
 * `complete` or `expired` is let go (a completed one shows up as a
 * subscription in the refresh that follows). Anything else, including a
 * Stripe outage, propagates: a session that may still be open must not be
 * joined by a second one.
 */
async function closeSession(stripe: Stripe, sessionId: string): Promise<void> {
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return;
  } catch (expireError) {
    const current = await stripe.checkout.sessions.retrieve(sessionId);
    if (current.status !== "complete" && current.status !== "expired") throw expireError;
    // Only the id and the status: the error and the session carry URLs and
    // customer details that do not belong in a log.
    logger.info("Checkout session was already closed", { sessionId, status: current.status });
  }
}

/**
 * Looks at the customer's unfinished Checkout sessions: returns one that is
 * for this same purchase (to be handed out again) and closes the others.
 * Each open session can still be paid; leaving a different one open (the
 * other plan in a second tab) is how a customer ends up with two
 * subscriptions.
 */
async function reuseOrCloseOpenSessions(
  stripe: Stripe,
  request: SessionRequest,
  nowMs: number,
): Promise<Stripe.Checkout.Session | null> {
  // ALL of them, following has_more: one that was never looked at would
  // stay payable next to the session handed out below.
  const open: Stripe.Checkout.Session[] = [];
  let startingAfter: string | undefined;
  for (let page = 1; ; page += 1) {
    const list = await stripe.checkout.sessions.list({
      customer: request.customerId,
      limit: OPEN_SESSIONS_PAGE_SIZE,
      status: "open",
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    open.push(...list.data);
    startingAfter = list.data.at(-1)?.id;
    if (!list.has_more || !startingAfter) break;
    if (page >= MAX_OPEN_SESSION_PAGES) {
      throw new BillingStateUnknownError("the customer has more open Checkout sessions than can be reviewed");
    }
  }

  let reusable: Stripe.Checkout.Session | null = null;
  for (const session of open) {
    if (!reusable && isReusable(session, request, nowMs)) {
      reusable = session;
      continue;
    }
    await closeSession(stripe, session.id);
  }
  return reusable;
}

export type StartCheckoutInput = {
  baseUrl: string;
  billingInterval: BillingInterval;
  /** How the per-user lease waits, for tests. */
  lease?: Pick<LeaseOptions, "now" | "sleep">;
  /** The clock (milliseconds), for tests. */
  now?: () => number;
  prices?: PriceConfig;
  successPath: CheckoutSuccessPath;
  /** How the refresh from Stripe reads and waits, for tests. */
  sync?: SyncOptions;
  userId: string;
};

export type StartCheckoutResult =
  | { kind: "url"; sessionId: string; url: string }
  /** Already subscribed (or comped): manage it in the portal instead. */
  | { kind: "subscription_exists" }
  | { kind: "user_not_found" };

export type CheckoutDb = BillingDb & LeaseDb;

/**
 * Creates a Checkout session for the Pro plan at the price the user's role
 * entitles them to, or returns the one already open for the same purchase.
 * Throws PriceNotConfiguredError when that price has no Stripe Price id
 * configured, LeaseBusyError when another request of the same user is
 * still at it (LeaseLostError, a kind of it, when this request ran past its
 * lease and another took over), BillingStateUnknownError when Stripe has
 * more for the customer than can be read, and Stripe's errors when Stripe
 * fails. In all of these nothing was created by this request.
 *
 * One purchase, one payable session. The whole sequence (close other open
 * sessions, refresh from Stripe, create) runs under a per-user lease, so
 * two requests at the same moment (a double click, two tabs, either plan)
 * cannot both find "nothing open" and both create: the second waits, then
 * finds the first one's session and reuses it (same price and return path)
 * or closes it (a different one). No fixed idempotency key is used for
 * that: Stripe would replay the stored response for a reused key, and a
 * later, legitimate checkout could be handed a session that is long dead.
 */
export async function startCheckout(
  db: CheckoutDb,
  stripe: Stripe,
  input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
  const user = await loadBillingUser(db, input.userId);
  if (!user) return { kind: "user_not_found" };

  // Before anything is created at Stripe: a misconfigured plan fails here.
  const priceId = getPriceIdForCheckout(user.role, input.billingInterval, input.prices);
  const successUrl = appUrl(input.baseUrl, input.successPath);
  const now = input.now ?? Date.now;

  const createSession = async (customer: string, lease: LeaseHandle) => {
    const request: SessionRequest = { customerId: customer, priceId, successUrl, userId: user.id };
    const reusable = await reuseOrCloseOpenSessions(stripe, request, now());
    const refreshed = await refreshBillingState(db, stripe, user.id, input.sync);

    // A subscription that has not ended, on the row or anywhere on the
    // customer (a second one the row does not show), is managed in the
    // portal. That includes a status this code does not know.
    if (refreshed.outcome === "listing_truncated") {
      throw new BillingStateUnknownError("the customer's subscriptions could not all be read");
    }
    const row = await db.subscription.findUnique({ where: { userId: user.id } });
    if (refreshed.hasLiveSubscription || (row && (row.isLifetime || !isTerminalStatus(row.status)))) {
      // Whatever was open must not be paid on top of it.
      if (reusable) await closeSession(stripe, reusable.id);
      return null;
    }
    if (reusable) return reusable;

    // Still this request's turn? (See CHECKOUT_LEASE_SECONDS.)
    if (!(await lease.renew())) throw new LeaseLostError(lease.key);

    return stripe.checkout.sessions.create({
      cancel_url: appUrl(input.baseUrl, CHECKOUT_CANCEL_PATH),
      client_reference_id: user.id,
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      // The user id travels on the session and on the subscription it
      // creates, so webhooks can be matched to the user without the email.
      // The price and (through success_url) the return path identify the
      // purchase, for reuse.
      metadata: { priceId, userId: user.id },
      mode: "subscription",
      subscription_data: { metadata: { userId: user.id } },
      success_url: successUrl,
    });
  };

  const session = await withLease(
    db,
    `checkout:${user.id}`,
    { ...input.lease, ttlSeconds: CHECKOUT_LEASE_SECONDS, waitMs: CHECKOUT_LEASE_WAIT_MS },
    async (lease) => {
      let customerId = await ensureCustomer(db, stripe, user, `my-iso:customer:${user.id}`);
      try {
        return await createSession(customerId, lease);
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
        return createSession(customerId, lease);
      }
    },
  );

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
