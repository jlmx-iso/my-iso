import type { Subscription } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { ErrorReason, logger } from "~/_utils";
import { env } from "~/env";
import {
  CHECKOUT_SUCCESS_PATHS,
  openBillingPortal,
  refreshBillingState,
  startCheckout,
} from "~/server/_billing/checkout";
import {
  entitlementsFor,
  isSubscriptionStatus,
  isTerminalStatus,
} from "~/server/_billing/entitlements";
import { loadSubscriptionForAccess } from "~/server/_billing/lazySync";
import { LeaseBusyError } from "~/server/_billing/lease";
import { reportBillingError } from "~/server/_billing/report";
import { RESYNC_MAX_BATCH, resyncSubscriptionBatch } from "~/server/_billing/resync";
import { getAccessCheckStripe, getStripe } from "~/server/_billing/stripe";
import { captureEvent } from "~/server/_lib/posthog";
import { getPricingForRole, PriceNotConfiguredError } from "~/server/_utils/pricing";
import { RateLimits } from "~/server/_utils/rateLimit";
import { reasonedError } from "~/server/api/reasonedError";
import { createTRPCRouter, founderProcedure, protectedProcedure, rateLimit } from "~/server/api/trpc";

/**
 * What the client is told about the caller's subscription.
 *
 * `status` mirrors Stripe: trialing, active, past_due, canceled, unpaid,
 * incomplete, incomplete_expired, paused.
 */
export type SubscriptionView = {
  /** When access ends unless something changes; null if it renews or there is none. */
  accessEndsAt: Date | null;
  /** The subscription is set to end at `cancelAt` and will not renew. */
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  /**
   * Why there is a subscription but no (or soon no) access, for a line of
   * guidance next to the "manage billing" action; null when nothing is
   * wrong. "unknown_status": Stripe reports a status this release does not
   * know; it is managed in the billing portal like the others.
   */
  billingIssue: BillingIssue | null;
  /**
   * A new checkout may be started (no running subscription). When false and
   * a subscription exists, offer `createPortalSession` instead: that is
   * where a failed payment is fixed and a paused or unfinished subscription
   * is resumed or ended.
   */
  canStartCheckout: boolean;
  currentPeriodEnd: Date | null;
  hasProAccess: boolean;
  /** "month" | "year" | null */
  interval: string | null;
  isLifetime: boolean;
  /** Access is withheld because of a dispute (chargeback) on a payment. */
  isDisputed: boolean;
  /** A payment failed and has not been recovered: ask them to update their card. */
  isPastDue: boolean;
  /** "founding" | "standard" | null */
  plan: string | null;
  /** The next renewal (charge) date; null when it will not renew. */
  renewsAt: Date | null;
  status: string;

  /** @deprecated Same as `hasProAccess`. */
  isActive: boolean;
  /** @deprecated True when cancelled or set to cancel; use `cancelAtPeriodEnd` / `status`. */
  isCanceled: boolean;
  /** @deprecated Use `accessEndsAt` / `currentPeriodEnd`. */
  expiresAt: Date | null;
};

export type BillingIssue =
  | "payment_failed"
  | "disputed"
  | "paused"
  | "incomplete"
  | "unknown_status";

function billingIssueOf(row: Subscription, entitlements: ReturnType<typeof entitlementsFor>): BillingIssue | null {
  if (row.isLifetime) return null;
  if (entitlements.isDisputed) return "disputed";
  if (entitlements.isPastDue) return "payment_failed";
  if (row.status === "paused") return "paused";
  if (row.status === "incomplete") return "incomplete";
  return isSubscriptionStatus(row.status) ? null : "unknown_status";
}

export function toSubscriptionView(row: Subscription, now: Date): SubscriptionView {
  const entitlements = entitlementsFor(row, now);
  const renews =
    (row.status === "active" || row.status === "trialing") && !row.cancelAtPeriodEnd;
  return {
    accessEndsAt: entitlements.accessEndsAt,
    billingIssue: billingIssueOf(row, entitlements),
    cancelAt: row.cancelAt,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canStartCheckout: !row.isLifetime && isTerminalStatus(row.status),
    currentPeriodEnd: row.currentPeriodEnd,
    expiresAt: entitlements.accessEndsAt ?? row.currentPeriodEnd,
    hasProAccess: entitlements.hasProAccess,
    interval: row.interval,
    isActive: entitlements.hasProAccess,
    isCanceled: row.cancelAtPeriodEnd || row.status === "canceled",
    isDisputed: entitlements.isDisputed,
    isLifetime: row.isLifetime,
    isPastDue: entitlements.isPastDue,
    plan: row.plan,
    renewsAt: renews ? row.currentPeriodEnd : null,
    status: row.status,
  };
}

/**
 * Stripe (or its configuration here) failed. The message makes NO claim
 * about charges, on any path. Not even a failed checkout start can promise
 * "you have not been charged": a session opened by an earlier request may
 * still be payable (this request can fail before it has listed and closed
 * the open ones), and a refresh, the portal or a re-sync failing says
 * nothing about what Stripe has or has not collected.
 */
function billingUnavailable(message: string, context: Record<string, unknown>): TRPCError {
  reportBillingError(message, context);
  return reasonedError(
    "SERVICE_UNAVAILABLE",
    ErrorReason.BILLING_UNAVAILABLE,
    "Billing is temporarily unavailable. Please try again in a few minutes.",
  );
}

export const subscriptionRouter = createTRPCRouter({
  /**
   * Get the pricing for the current user based on their role.
   * Founding members / ambassadors get discounted rates.
   */
  getPricing: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const user = await ctx.db.user.findUnique({
      select: { role: true },
      where: { id: userId },
    });
    return getPricingForRole(user?.role ?? "standard");
  }),

  /**
   * The caller's subscription as stored (kept current by Stripe webhooks),
   * or null when they have never had one. See SubscriptionView. A row that
   * was never read from Stripe is synced first (see _billing/lazySync.ts).
   */
  getStatus: protectedProcedure.query(async ({ ctx }): Promise<SubscriptionView | null> => {
    const row = await loadSubscriptionForAccess(ctx.db, getAccessCheckStripe, ctx.session.user.id);
    return row ? toSubscriptionView(row, new Date()) : null;
  }),

  /**
   * Starts Stripe Checkout for the Pro plan and returns the URL to send the
   * browser to. Founding or standard pricing is decided here from the
   * caller's role; `billingInterval` picks monthly or annual.
   *
   * Errors:
   * - CONFLICT, reason `subscription_exists`: the caller already has a
   *   subscription that has not ended (or a comped account). Nothing was
   *   created; use `createPortalSession`.
   * - SERVICE_UNAVAILABLE, reason `billing_unavailable`: Stripe failed or
   *   the plan has no price configured.
   */
  createCheckoutSession: protectedProcedure
    .use(rateLimit(RateLimits.BILLING_CHECKOUT))
    .input(
      z.object({
        billingInterval: z.enum(["monthly", "annual"]),
        /** Where to land after payment: one of a fixed list. */
        successPath: z.enum(CHECKOUT_SUCCESS_PATHS).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      let result: Awaited<ReturnType<typeof startCheckout>>;
      try {
        result = await startCheckout(ctx.db, getStripe(), {
          baseUrl: env.NEXT_PUBLIC_BASE_URL,
          billingInterval: input.billingInterval,
          successPath: input.successPath ?? "/app/settings?checkout=success",
          userId,
        });
      } catch (error) {
        if (error instanceof LeaseBusyError) {
          // Another request of this user is starting checkout right now (a
          // double click, a second tab). Nothing was created by this one.
          throw new TRPCError({
            code: "CONFLICT",
            message: "Checkout is already being opened. Please try again in a moment.",
          });
        }
        throw billingUnavailable(
          error instanceof PriceNotConfiguredError
            ? "Checkout is not available: a Stripe price id is not configured"
            : "Error creating Stripe checkout session",
          { error, userId },
        );
      }

      if (result.kind === "user_not_found") {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      if (result.kind === "subscription_exists") {
        throw reasonedError(
          "CONFLICT",
          ErrorReason.SUBSCRIPTION_EXISTS,
          "You already have a subscription. Manage it from your billing settings.",
        );
      }

      logger.info("Stripe checkout session created", {
        billingInterval: input.billingInterval,
        sessionId: result.sessionId,
        userId,
      });
      captureEvent(userId, "upgrade_initiated", { billing: input.billingInterval });

      return { url: result.url };
    }),

  /**
   * Opens the Stripe billing portal (update card, cancel, invoices) and
   * returns its URL.
   *
   * Errors:
   * - PRECONDITION_FAILED, reason `no_billing_account`: the caller has never
   *   subscribed. Offer checkout.
   * - SERVICE_UNAVAILABLE, reason `billing_unavailable`.
   */
  createPortalSession: protectedProcedure
    .use(rateLimit(RateLimits.BILLING_PORTAL))
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      let result: Awaited<ReturnType<typeof openBillingPortal>>;
      try {
        result = await openBillingPortal(ctx.db, getStripe(), {
          baseUrl: env.NEXT_PUBLIC_BASE_URL,
          userId,
        });
      } catch (error) {
        throw billingUnavailable("Error creating Stripe portal session", { error, userId });
      }

      if (result.kind === "no_billing_account") {
        throw reasonedError(
          "PRECONDITION_FAILED",
          ErrorReason.NO_BILLING_ACCOUNT,
          "There is no subscription to manage yet. Subscribe to a plan first.",
        );
      }
      return { url: result.url };
    }),

  /**
   * Re-derives the caller's subscription from Stripe and returns it, like
   * `getStatus`. For the return from Checkout (the webhook may not have
   * arrived yet) and as a manual "refresh". Rate limited.
   *
   * Errors: SERVICE_UNAVAILABLE, reason `billing_unavailable`.
   */
  syncStatus: protectedProcedure
    .use(rateLimit(RateLimits.BILLING_SYNC))
    .mutation(async ({ ctx }): Promise<SubscriptionView | null> => {
      const userId = ctx.session.user.id;
      try {
        // With the payment standing: someone held back by a lost dispute
        // who has paid since must be able to put that right from here if
        // the `invoice.paid` event is late.
        await refreshBillingState(ctx.db, getStripe(), userId, { standing: true });
      } catch (error) {
        throw billingUnavailable("Error syncing subscription from Stripe", { error, userId });
      }
      const row = await ctx.db.subscription.findUnique({ where: { userId } });
      return row ? toSubscriptionView(row, new Date()) : null;
    }),

  /**
   * ADMIN (founder/ambassador): re-derives stored subscription rows from
   * Stripe, one bounded batch per call. Call it again with the returned
   * `nextCursor` until that is null. Safe to repeat and to interrupt.
   *
   * `scope` "pending" (default): rows never read from Stripe, or whose
   * legacy flags disagree with their status. "all": every row with a
   * Stripe subscription or customer. See docs/BILLING.md.
   *
   * `unresolved` lists the rows of the batch that are not settled, by
   * Subscription id with the outcome that left them so.
   *
   * Errors: SERVICE_UNAVAILABLE, reason `billing_unavailable`.
   */
  resyncFromStripe: founderProcedure
    .use(rateLimit(RateLimits.BILLING_RESYNC))
    .input(
      z.object({
        cursor: z.string().min(1).max(64).nullish(),
        limit: z.number().int().min(1).max(RESYNC_MAX_BATCH).optional(),
        scope: z.enum(["pending", "all"]).default("pending"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await resyncSubscriptionBatch(ctx.db, getStripe(), input);
        logger.info("Subscription re-sync batch", { ...result, scope: input.scope });
        return result;
      } catch (error) {
        throw billingUnavailable("Error re-syncing subscriptions from Stripe", {
          error,
          userId: ctx.session.user.id,
        });
      }
    }),
});
