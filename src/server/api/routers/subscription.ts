import Stripe from "stripe";
import { z } from "zod";

import { logger } from "~/_utils";
import { env } from "~/env";
import { getPriceIdForCheckout, getPricingForRole } from "~/server/_utils/pricing";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export const subscriptionRouter = createTRPCRouter({
  /**
   * Get the current user's subscription status.
   * Returns the Subscription record or null if no subscription exists.
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscription = await ctx.db.subscription
      .findUnique({
        where: { userId },
      })
      .catch((error: unknown) => {
        logger.error("Error fetching subscription status", {
          error: error instanceof Error ? error.message : "Unknown error",
          userId,
        });
        throw new Error("Error fetching subscription status");
      });

    return subscription;
  }),

  /**
   * Create a Stripe Checkout session for the Pro plan.
   * Uses the user's role to determine founding vs standard pricing,
   * and the billingInterval to select monthly vs annual.
   */
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        billingInterval: z.enum(["monthly", "annual"]).default("monthly"),
      }).optional()
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const userEmail = ctx.session.user.email;
      const billingInterval = input?.billingInterval ?? "monthly";

      if (!userEmail) {
        throw new Error("User email is required to create a checkout session");
      }

      // Look up user's role and Stripe customer ID
      const user = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { role: true, stripeId: true },
      });

      const role = user?.role ?? "standard";
      const priceId = getPriceIdForCheckout(role, billingInterval);
      const pricing = getPricingForRole(role);

      // Build line_items based on whether we have a Stripe Price ID or need inline price_data
      let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
      if (priceId) {
        lineItems = [{ price: priceId, quantity: 1 }];
      } else {
        const amount = billingInterval === "monthly"
          ? pricing.monthlyPrice * 100
          : pricing.annualPrice * 100;
        lineItems = [
          {
            price_data: {
              currency: "usd",
              product_data: {
                description:
                  "Unlimited bookings, priority search placement, analytics dashboard, and more.",
                name: "ISO Pro",
              },
              recurring: {
                interval: billingInterval === "monthly" ? "month" : "year",
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ];
      }

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        cancel_url: `${env.BASE_URL}/app/settings?checkout=canceled`,
        client_reference_id: userId,
        line_items: lineItems,
        metadata: { userId },
        mode: "subscription",
        payment_method_types: ["card"],
        success_url: `${env.BASE_URL}/app/settings?checkout=success`,
      };

      // Use existing Stripe customer if available, otherwise let Stripe create one
      if (user?.stripeId) {
        sessionParams.customer = user.stripeId;
      } else {
        sessionParams.customer_email = userEmail;
      }

      const session = await stripe.checkout.sessions
        .create(sessionParams)
        .catch((error: unknown) => {
          logger.error("Error creating Stripe checkout session", {
            error: error instanceof Error ? error.message : "Unknown error",
            userId,
          });
          throw new Error("Error creating checkout session");
        });

      logger.info("Stripe checkout session created", {
        billingInterval,
        role,
        sessionId: session.id,
        userId,
      });

      return { url: session.url };
    }),

  /**
   * Create a Stripe Billing Portal session for managing an existing subscription.
   * Returns the portal session URL for redirect.
   */
  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Get the user's Stripe customer ID
    const user = await ctx.db.user.findUnique({
      where: { id: userId },
      select: { stripeId: true },
    });

    if (!user?.stripeId) {
      throw new Error(
        "No Stripe customer found. Please subscribe to a plan first."
      );
    }

    const session = await stripe.billingPortal.sessions
      .create({
        customer: user.stripeId,
        return_url: `${env.BASE_URL}/app/settings`,
      })
      .catch((error: unknown) => {
        logger.error("Error creating Stripe portal session", {
          error: error instanceof Error ? error.message : "Unknown error",
          userId,
        });
        throw new Error("Error creating portal session");
      });

    logger.info("Stripe portal session created", {
      sessionId: session.id,
      userId,
    });

    return { url: session.url };
  }),

  /**
   * Sync subscription status from Stripe to the database.
   * Useful for manual re-sync after webhook processing.
   */
  syncStatus: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Get user's Stripe customer ID
    const user = await ctx.db.user.findUnique({
      where: { id: userId },
      select: { stripeId: true },
    });

    if (!user?.stripeId) {
      logger.info("No Stripe customer ID for user, skipping sync", { userId });
      return null;
    }

    // Fetch subscriptions from Stripe
    const subscriptions = await stripe.subscriptions
      .list({
        customer: user.stripeId,
        limit: 1,
        status: "all",
      })
      .catch((error: unknown) => {
        logger.error("Error fetching Stripe subscriptions", {
          error: error instanceof Error ? error.message : "Unknown error",
          userId,
        });
        throw new Error("Error fetching subscription data from Stripe");
      });

    const stripeSubscription = subscriptions.data[0];

    if (!stripeSubscription) {
      logger.info("No Stripe subscription found for user", { userId });
      return null;
    }

    const isActive =
      stripeSubscription.status === "active" ||
      stripeSubscription.status === "trialing";
    const isCanceled = stripeSubscription.cancel_at_period_end;
    const isPaused = stripeSubscription.pause_collection !== null;
    const isTrial = stripeSubscription.status === "trialing";
    const isExpired =
      stripeSubscription.status === "canceled" ||
      stripeSubscription.status === "unpaid";
    const expiresAt = stripeSubscription.current_period_end
      ? new Date(stripeSubscription.current_period_end * 1000)
      : null;

    const subscription = await ctx.db.subscription
      .upsert({
        where: { userId },
        create: {
          userId,
          subscriptionId: stripeSubscription.id,
          isActive,
          isCanceled,
          isPaused,
          isTrial,
          isExpired,
          isPending: false,
          isLifetime: false,
          expiresAt,
        },
        update: {
          subscriptionId: stripeSubscription.id,
          isActive,
          isCanceled,
          isPaused,
          isTrial,
          isExpired,
          isPending: false,
          expiresAt,
        },
      })
      .catch((error: unknown) => {
        logger.error("Error syncing subscription to database", {
          error: error instanceof Error ? error.message : "Unknown error",
          userId,
        });
        throw new Error("Error syncing subscription status");
      });

    logger.info("Subscription synced from Stripe", {
      userId,
      subscriptionId: stripeSubscription.id,
      status: stripeSubscription.status,
      isActive,
    });

    return subscription;
  }),
});
