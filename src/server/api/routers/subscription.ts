import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { z } from "zod";

import { logger } from "~/_utils";
import { env } from "~/env";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export const subscriptionRouter = createTRPCRouter({
  // Create Stripe checkout session
  createCheckoutSession: protectedProcedure
    .input(z.object({
      cancelUrl: z.string().url(),
      priceId: z.string(),
      successUrl: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;

      // Get or create Stripe customer
      let stripeCustomerId = user.stripeId;

      if (!stripeCustomerId) {
        try {
          const customer = await stripe.customers.create({
            email: user.email,
            metadata: { userId: user.id },
          });

          // Update user with stripe ID
          await ctx.db.user.update({
            data: { stripeId: customer.id },
            where: { id: user.id },
          });

          stripeCustomerId = customer.id;
        } catch (error) {
          logger.error("Failed to create Stripe customer", { error, userId: user.id });
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: "Failed to create Stripe customer",
          });
        }
      }

      // Create checkout session
      try {
        const session = await stripe.checkout.sessions.create({
          cancel_url: input.cancelUrl,
          customer: stripeCustomerId,
          line_items: [{ price: input.priceId, quantity: 1 }],
          mode: 'subscription',
          payment_method_types: ['card'],
          success_url: input.successUrl,
        });

        return { sessionId: session.id, url: session.url };
      } catch (error) {
        logger.error("Failed to create checkout session", { error, userId: user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: "Failed to create checkout session",
        });
      }
    }),

  // Get current subscription
  getCurrentSubscription: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.db.subscription.findUnique({
        where: { userId: ctx.session.user.id },
      });
    }),

  // Create customer portal session (for managing subscription)
  createPortalSession: protectedProcedure
    .input(z.object({ returnUrl: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
      });

      if (!user?.stripeId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "No Stripe customer found",
        });
      }

      try {
        const session = await stripe.billingPortal.sessions.create({
          customer: user.stripeId,
          return_url: input.returnUrl,
        });

        return { url: session.url };
      } catch (error) {
        logger.error("Failed to create portal session", { error, userId: user.id });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: "Failed to create portal session",
        });
      }
    }),
});
