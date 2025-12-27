import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { z } from "zod";

import { logger } from "~/_utils";
import { env } from "~/env";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

// Validate that URLs are for this application only
const urlValidator = z.string().url().refine(
  (url) => url.startsWith(env.BASE_URL),
  "URL must be for this application"
);

// Validate price IDs against allowed values
const ALLOWED_PRICE_IDS = [
  env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO,
  // Add more price IDs here as you create more plans
];

const priceIdValidator = z.string().refine(
  (priceId) => ALLOWED_PRICE_IDS.includes(priceId),
  "Invalid price ID"
);

export const subscriptionRouter = createTRPCRouter({
  // Create Stripe checkout session
  createCheckoutSession: protectedProcedure
    .input(z.object({
      cancelUrl: urlValidator,
      priceId: priceIdValidator,
      successUrl: urlValidator,
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;

      logger.info("Creating checkout session", {
        priceId: input.priceId,
        userId: user.id,
      });

      // Check if user already has an active subscription
      const existingSubscription = await ctx.db.subscription.findUnique({
        where: { userId: user.id },
      });

      if (existingSubscription?.isActive) {
        logger.warn("User attempted to create checkout with active subscription", {
          subscriptionId: existingSubscription.id,
          userId: user.id,
        });
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "You already have an active subscription",
        });
      }

      // Get or create Stripe customer with transaction safety
      let stripeCustomerId = user.stripeId;

      if (!stripeCustomerId) {
        try {
          // Check again inside try block to handle race conditions
          const freshUser = await ctx.db.user.findUnique({
            where: { id: user.id },
          });

          if (freshUser?.stripeId) {
            stripeCustomerId = freshUser.stripeId;
            logger.info("Found existing Stripe customer from race condition check", {
              stripeCustomerId,
              userId: user.id,
            });
          } else {
            // Create new Stripe customer
            const customer = await stripe.customers.create({
              email: user.email,
              metadata: { userId: user.id },
              name: `${user.firstName} ${user.lastName}`,
            });

            // Update database with new customer ID
            const updatedUser = await ctx.db.user.update({
              data: { stripeId: customer.id },
              where: { id: user.id },
            });

            stripeCustomerId = customer.id;

            logger.info("Created new Stripe customer", {
              stripeCustomerId,
              userId: user.id,
            });
          }
        } catch (error) {
          logger.error("Failed to create or update Stripe customer", {
            error,
            userId: user.id,
          });
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: "Failed to create customer. Please try again.",
          });
        }
      }

      // Create checkout session
      try {
        const session = await stripe.checkout.sessions.create({
          cancel_url: input.cancelUrl,
          customer: stripeCustomerId,
          line_items: [{ price: input.priceId, quantity: 1 }],
          metadata: {
            userId: user.id,
          },
          mode: 'subscription',
          payment_method_types: ['card'],
          subscription_data: {
            metadata: {
              planName: 'Pro', // Update this when you have multiple plans
              userId: user.id,
            },
          },
          success_url: input.successUrl,
        });

        logger.info("Checkout session created successfully", {
          sessionId: session.id,
          stripeCustomerId,
          userId: user.id,
        });

        return { sessionId: session.id, url: session.url };
      } catch (error) {
        logger.error("Failed to create checkout session", {
          error,
          stripeCustomerId,
          userId: user.id,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: "Failed to create checkout session. Please try again.",
        });
      }
    }),

  // Get current subscription
  getCurrentSubscription: protectedProcedure
    .query(async ({ ctx }) => {
      const subscription = await ctx.db.subscription.findUnique({
        where: { userId: ctx.session.user.id },
      });

      logger.info("Retrieved subscription", {
        hasSubscription: !!subscription,
        isActive: subscription?.isActive,
        userId: ctx.session.user.id,
      });

      return subscription;
    }),

  // Create customer portal session (for managing subscription)
  createPortalSession: protectedProcedure
    .input(z.object({ returnUrl: urlValidator }))
    .mutation(async ({ ctx, input }) => {
      // Get fresh user data to ensure we have latest stripeId
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
      });

      if (!user?.stripeId) {
        logger.warn("User attempted to access portal without Stripe customer", {
          userId: ctx.session.user.id,
        });
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "No subscription found. Please subscribe first.",
        });
      }

      try {
        const session = await stripe.billingPortal.sessions.create({
          customer: user.stripeId,
          return_url: input.returnUrl,
        });

        logger.info("Portal session created", {
          portalUrl: session.url,
          userId: user.id,
        });

        return { url: session.url };
      } catch (error) {
        logger.error("Failed to create portal session", {
          error,
          userId: user.id,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: "Failed to open subscription management. Please try again.",
        });
      }
    }),
});
