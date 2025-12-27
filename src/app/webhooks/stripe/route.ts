import { type NextRequest } from "next/server";
import Stripe from "stripe";

import { logger } from "~/_utils";
import { env } from "~/env";
import { db } from "~/server/db";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    logger.error("Webhook missing signature");
    return new Response("No signature", { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error("Webhook signature verification failed", { error: err });
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.created':
      case 'customer.updated':
        await handleCustomerUpdate(event.data.object as Stripe.Customer);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        logger.info("Unhandled webhook event", { type: event.type });
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    logger.error("Webhook handler error", { error: err, type: event.type });
    return new Response("Webhook handler failed", { status: 500 });
  }
}

async function handleCustomerUpdate(customer: Stripe.Customer) {
  if (!customer.email) {
    logger.warn("Customer update without email", { customerId: customer.id });
    return;
  }

  try {
    await db.user.update({
      data: { stripeId: customer.id },
      where: { email: customer.email },
    });
    logger.info("Updated user with Stripe customer ID", {
      customerId: customer.id,
      email: customer.email,
    });
  } catch (error) {
    logger.error("Failed to update user with Stripe ID", {
      customerId: customer.id,
      email: customer.email,
      error,
    });
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const user = await db.user.findUnique({
    where: { stripeId: subscription.customer as string },
  });

  if (!user) {
    logger.error("User not found for subscription", {
      customerId: subscription.customer,
      subscriptionId: subscription.id,
    });
    return;
  }

  const isActive = subscription.status === 'active';
  const isTrial = subscription.status === 'trialing';
  const isCanceled = subscription.cancel_at_period_end;
  const isPaused = subscription.pause_collection !== null;
  const expiresAt = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  try {
    await db.subscription.upsert({
      create: {
        expiresAt,
        isActive,
        isCanceled,
        isExpired: false,
        isLifetime: false,
        isPaused,
        isPending: false,
        isTrial,
        subscriptionId: subscription.id,
        userId: user.id,
      },
      update: {
        expiresAt,
        isActive,
        isCanceled,
        isExpired: false,
        isPaused,
        isTrial,
        subscriptionId: subscription.id,
      },
      where: { userId: user.id },
    });

    logger.info("Subscription updated", {
      isActive,
      status: subscription.status,
      subscriptionId: subscription.id,
      userId: user.id,
    });
  } catch (error) {
    logger.error("Failed to update subscription", {
      error,
      subscriptionId: subscription.id,
      userId: user.id,
    });
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const user = await db.user.findUnique({
    where: { stripeId: subscription.customer as string },
  });

  if (!user) {
    logger.warn("User not found for subscription deletion", {
      customerId: subscription.customer,
      subscriptionId: subscription.id,
    });
    return;
  }

  try {
    await db.subscription.update({
      data: {
        isActive: false,
        isCanceled: true,
        isExpired: true,
      },
      where: { userId: user.id },
    });

    logger.info("Subscription deleted", {
      subscriptionId: subscription.id,
      userId: user.id,
    });
  } catch (error) {
    logger.error("Failed to mark subscription as deleted", {
      error,
      subscriptionId: subscription.id,
      userId: user.id,
    });
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  logger.info("Payment succeeded", {
    amount: invoice.amount_paid,
    customerId: invoice.customer,
    invoiceId: invoice.id,
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  logger.error("Payment failed", {
    attemptCount: invoice.attempt_count,
    customerId: invoice.customer,
    invoiceId: invoice.id,
  });

  // Optional: Send notification to user about failed payment
  // Could add email notification here
}