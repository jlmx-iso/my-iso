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
import { entitlementsFor, isTerminalStatus } from "~/server/_billing/entitlements";
import { reportBillingError } from "~/server/_billing/report";
import { getStripe } from "~/server/_billing/stripe";
import { captureEvent } from "~/server/_lib/posthog";
import { getPricingForRole, PriceNotConfiguredError } from "~/server/_utils/pricing";
import { RateLimits } from "~/server/_utils/rateLimit";
import { reasonedError } from "~/server/api/reasonedError";
import { createTRPCRouter, protectedProcedure, rateLimit } from "~/server/api/trpc";

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
  /** A new checkout may be started (no running subscription). */
  canStartCheckout: boolean;
  currentPeriodEnd: Date | null;
  hasProAccess: boolean;
  /** "month" | "year" | null */
  interval: string | null;
  isLifetime: boolean;
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

export function toSubscriptionView(row: Subscription, now: Date): SubscriptionView {
  const entitlements = entitlementsFor(row, now);
  const renews =
    (row.status === "active" || row.status === "trialing") && !row.cancelAtPeriodEnd;
  return {
    accessEndsAt: entitlements.accessEndsAt,
    cancelAt: row.cancelAt,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canStartCheckout: !row.isLifetime && isTerminalStatus(row.status),
    currentPeriodEnd: row.currentPeriodEnd,
    expiresAt: entitlements.accessEndsAt ?? row.currentPeriodEnd,
    hasProAccess: entitlements.hasProAccess,
    interval: row.interval,
    isActive: entitlements.hasProAccess,
    isCanceled: row.cancelAtPeriodEnd || row.status === "canceled",
    isLifetime: row.isLifetime,
    isPastDue: entitlements.isPastDue,
    plan: row.plan,
    renewsAt: renews ? row.currentPeriodEnd : null,
    status: row.status,
  };
}

/** Stripe (or its configuration here) failed: nothing was charged. */
function billingUnavailable(message: string, context: Record<string, unknown>): TRPCError {
  reportBillingError(message, context);
  return reasonedError(
    "SERVICE_UNAVAILABLE",
    ErrorReason.BILLING_UNAVAILABLE,
    "Billing is temporarily unavailable. You have not been charged. Please try again in a few minutes.",
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
   * or null when they have never had one. See SubscriptionView.
   */
  getStatus: protectedProcedure.query(async ({ ctx }): Promise<SubscriptionView | null> => {
    const row = await ctx.db.subscription.findUnique({
      where: { userId: ctx.session.user.id },
    });
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
        await refreshBillingState(ctx.db, getStripe(), userId);
      } catch (error) {
        throw billingUnavailable("Error syncing subscription from Stripe", { error, userId });
      }
      const row = await ctx.db.subscription.findUnique({ where: { userId } });
      return row ? toSubscriptionView(row, new Date()) : null;
    }),
});
