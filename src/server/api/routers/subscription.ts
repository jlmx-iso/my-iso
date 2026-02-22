import Stripe from "stripe";
import { z } from "zod";

import { logger } from "~/_utils";
import { env } from "~/env";
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
   * Create a Stripe Checkout session for the Pro plan ($10/mo).
   * Returns the checkout session URL for redirect.
   */
  createCheckoutSession: protectedProcedure
    .input(
      z
        .object({
          priceId: z.string().min(1),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const userEmail = ctx.session.user.email;

      if (!userEmail) {
        throw new Error("User email is required to create a checkout session");
      }

      // Check if user already has a Stripe customer ID
      const user = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { stripeId: true },
      });

      // Build checkout session params
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "ISO Pro",
                description:
                  "Unlimited bookings, priority search placement, analytics dashboard, and more.",
              },
              unit_amount: 1000, // $10.00 in cents
              recurring: {
                interval: "month",
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${env.BASE_URL}/app/settings?checkout=success`,
        cancel_url: `${env.BASE_URL}/app/settings?checkout=canceled`,
        client_reference_id: userId,
        metadata: {
          userId,
        },
      };

      // Use existing Stripe customer if available, otherwise let Stripe create one
      if (user?.stripeId) {
        sessionParams.customer = user.stripeId;
      } else {
        sessionParams.customer_email = userEmail;
      }

      // If a specific priceId was passed, use it instead of inline price_data
      if (input?.priceId) {
        sessionParams.line_items = [
          {
            price: input.priceId,
            quantity: 1,
          },
        ];
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
