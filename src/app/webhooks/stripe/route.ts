import { type NextRequest } from "next/server";
import Stripe from "stripe";

import { logger } from "~/_utils";
import { env } from "~/env";
import { db } from "~/server/db";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

/**
 * Stripe webhook handler with signature verification
 * SECURITY: Verifies all webhook events using Stripe signature to prevent forgery
 */
const handler = async (req: NextRequest) => {
  // Get Stripe signature from headers
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    logger.warn('Stripe webhook rejected: missing signature header');
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  // Get raw body for signature verification (must not be JSON parsed yet)
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    // Verify webhook signature and parse event
    // This prevents attackers from forging webhook events
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: unknown) {
    logger.error('Stripe webhook signature verification failed', {
      error: err instanceof Error ? err.message : 'Unknown error'
    });
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    // Handle different event types
    switch (event.type) {
      // ── Customer events (existing) ──────────────────────────────────
      case 'customer.created':
      case 'customer.updated': {
        const customer = event.data.object as Stripe.Customer;
        const customerEmail = customer.email;

        if (!customerEmail) {
          logger.warn('Stripe webhook: customer has no email', {
            customerId: customer.id,
            eventType: event.type,
          });
          return new Response('Email is required', { status: 400 });
        }

        const customerInDb = await db.user.update({
          data: { stripeId: customer.id },
          where: { email: customerEmail },
        });

        logger.info('Stripe customer synced to database', {
          userId: customerInDb.id,
          stripeId: customer.id,
          eventType: event.type,
        });
        break;
      }

      // ── Checkout completed ──────────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.mode !== 'subscription') {
          logger.info('Checkout session is not subscription mode, skipping', {
            sessionId: session.id,
            mode: session.mode,
          });
          break;
        }

        const customerEmail = session.customer_email ?? session.customer_details?.email;
        const userId = session.client_reference_id ?? session.metadata?.userId;
        const subscriptionId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;

        if (!userId && !customerEmail) {
          logger.warn('checkout.session.completed: no userId or email found', {
            sessionId: session.id,
          });
          break;
        }

        // Resolve the user ID from email if not directly available
        let resolvedUserId = userId;
        if (!resolvedUserId && customerEmail) {
          const user = await db.user.findUnique({
            where: { email: customerEmail },
            select: { id: true },
          });
          resolvedUserId = user?.id;
        }

        if (!resolvedUserId) {
          logger.warn('checkout.session.completed: could not resolve user', {
            sessionId: session.id,
            customerEmail,
          });
          break;
        }

        await db.subscription.upsert({
          where: { userId: resolvedUserId },
          create: {
            userId: resolvedUserId,
            subscriptionId: subscriptionId ?? null,
            isActive: true,
            isTrial: false,
            isCanceled: false,
            isPaused: false,
            isPending: false,
            isExpired: false,
            isLifetime: false,
          },
          update: {
            subscriptionId: subscriptionId ?? null,
            isActive: true,
            isPending: false,
            isCanceled: false,
            isExpired: false,
          },
        });

        logger.info('Subscription created from checkout', {
          userId: resolvedUserId,
          subscriptionId,
          sessionId: session.id,
        });
        break;
      }

      // ── Invoice payment succeeded ───────────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id;

        if (!customerId) {
          logger.warn('invoice.payment_succeeded: no customer ID', {
            invoiceId: invoice.id,
          });
          break;
        }

        // Find user by stripeId
        const user = await db.user.findUnique({
          where: { stripeId: customerId },
          select: { id: true },
        });

        if (!user) {
          logger.warn('invoice.payment_succeeded: user not found for customer', {
            customerId,
            invoiceId: invoice.id,
          });
          break;
        }

        // Determine the subscription period end
        const periodEnd = invoice.lines?.data?.[0]?.period?.end;
        const expiresAt = periodEnd ? new Date(periodEnd * 1000) : null;

        await db.subscription.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            subscriptionId: typeof invoice.subscription === 'string'
              ? invoice.subscription
              : invoice.subscription?.id ?? null,
            isActive: true,
            isTrial: false,
            isCanceled: false,
            isPaused: false,
            isPending: false,
            isExpired: false,
            isLifetime: false,
            expiresAt,
          },
          update: {
            isActive: true,
            isExpired: false,
            expiresAt,
          },
        });

        logger.info('Subscription activated after payment', {
          userId: user.id,
          invoiceId: invoice.id,
          expiresAt: expiresAt?.toISOString(),
        });
        break;
      }

      // ── Invoice payment failed ──────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id;

        if (!customerId) {
          logger.warn('invoice.payment_failed: no customer ID', {
            invoiceId: invoice.id,
          });
          break;
        }

        const user = await db.user.findUnique({
          where: { stripeId: customerId },
          select: { id: true },
        });

        if (!user) {
          logger.warn('invoice.payment_failed: user not found for customer', {
            customerId,
            invoiceId: invoice.id,
          });
          break;
        }

        await db.subscription.updateMany({
          where: { userId: user.id },
          data: { isActive: false },
        });

        logger.info('Subscription deactivated after payment failure', {
          userId: user.id,
          invoiceId: invoice.id,
        });
        break;
      }

      // ── Subscription created ────────────────────────────────────────
      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;

        const user = await db.user.findUnique({
          where: { stripeId: customerId },
          select: { id: true },
        });

        if (!user) {
          logger.warn('customer.subscription.created: user not found', {
            customerId,
            subscriptionId: subscription.id,
          });
          break;
        }

        const isActive = subscription.status === 'active' || subscription.status === 'trialing';
        const expiresAt = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null;

        await db.subscription.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            subscriptionId: subscription.id,
            isActive,
            isTrial: subscription.status === 'trialing',
            isCanceled: subscription.cancel_at_period_end,
            isPaused: subscription.pause_collection !== null,
            isPending: subscription.status === 'incomplete',
            isExpired: false,
            isLifetime: false,
            expiresAt,
          },
          update: {
            subscriptionId: subscription.id,
            isActive,
            isTrial: subscription.status === 'trialing',
            isCanceled: subscription.cancel_at_period_end,
            isPaused: subscription.pause_collection !== null,
            isPending: subscription.status === 'incomplete',
            isExpired: false,
            expiresAt,
          },
        });

        logger.info('Subscription record created', {
          userId: user.id,
          subscriptionId: subscription.id,
          status: subscription.status,
        });
        break;
      }

      // ── Subscription updated ────────────────────────────────────────
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;

        const user = await db.user.findUnique({
          where: { stripeId: customerId },
          select: { id: true },
        });

        if (!user) {
          logger.warn('customer.subscription.updated: user not found', {
            customerId,
            subscriptionId: subscription.id,
          });
          break;
        }

        const isActive = subscription.status === 'active' || subscription.status === 'trialing';
        const isExpired = subscription.status === 'canceled' || subscription.status === 'unpaid';
        const expiresAt = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null;

        await db.subscription.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            subscriptionId: subscription.id,
            isActive,
            isTrial: subscription.status === 'trialing',
            isCanceled: subscription.cancel_at_period_end,
            isPaused: subscription.pause_collection !== null,
            isPending: subscription.status === 'incomplete',
            isExpired,
            isLifetime: false,
            expiresAt,
          },
          update: {
            subscriptionId: subscription.id,
            isActive,
            isTrial: subscription.status === 'trialing',
            isCanceled: subscription.cancel_at_period_end,
            isPaused: subscription.pause_collection !== null,
            isPending: subscription.status === 'incomplete',
            isExpired,
            expiresAt,
          },
        });

        logger.info('Subscription record updated', {
          userId: user.id,
          subscriptionId: subscription.id,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        });
        break;
      }

      // ── Subscription deleted ────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;

        const user = await db.user.findUnique({
          where: { stripeId: customerId },
          select: { id: true },
        });

        if (!user) {
          logger.warn('customer.subscription.deleted: user not found', {
            customerId,
            subscriptionId: subscription.id,
          });
          break;
        }

        await db.subscription.updateMany({
          where: { userId: user.id },
          data: {
            isActive: false,
            isCanceled: true,
            isExpired: true,
          },
        });

        logger.info('Subscription canceled and deactivated', {
          userId: user.id,
          subscriptionId: subscription.id,
        });
        break;
      }

      default: {
        // Log unhandled event types for monitoring
        logger.info('Unhandled Stripe webhook event type', {
          eventType: event.type,
          eventId: event.id,
        });
      }
    }
  } catch (err: unknown) {
    logger.error('Error processing Stripe webhook event', {
      error: err instanceof Error ? err.message : 'Unknown error',
      eventType: event.type,
      eventId: event.id,
    });
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}

export { handler as GET, handler as POST };

