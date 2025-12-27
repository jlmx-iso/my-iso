import { type NextRequest } from "next/server";
import Stripe from "stripe";

import { logger } from "~/_utils";
import { env } from "~/env";
import { db } from "~/server/db";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

// Helper to safely get customer ID from Stripe object
function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
  return typeof customer === 'string' ? customer : customer.id;
}

// Helper to check all subscription statuses
function getSubscriptionFlags(subscription: Stripe.Subscription) {
  const status = subscription.status;

  return {
    expiresAt: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
    isActive: status === 'active' || status === 'trialing' || status === 'past_due',
    isCanceled: subscription.cancel_at_period_end,
    isExpired: status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired',
    isPaused: subscription.pause_collection !== null,
    isPending: status === 'incomplete',
    isTrial: status === 'trialing',
  };
}

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

  // Check for idempotency - has this event been processed already?
  const existingEvent = await db.webhookEvent.findUnique({
    where: { eventId: event.id },
  });

  if (existingEvent) {
    logger.info("Webhook event already processed", { eventId: event.id, eventType: event.type });
    return new Response("OK - already processed", { status: 200 });
  }

  // Track this event as being processed
  let processingError: Error | null = null;

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

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

      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.upcoming':
        await handleInvoiceUpcoming(event.data.object as Stripe.Invoice);
        break;

      default:
        logger.info("Unhandled webhook event", { type: event.type });
    }

    // Mark event as successfully processed
    await db.webhookEvent.create({
      data: {
        error: null,
        eventId: event.id,
        eventType: event.type,
        status: 'processed',
      },
    });

    logger.info("Webhook event processed successfully", { eventId: event.id, eventType: event.type });
    return new Response("OK", { status: 200 });
  } catch (err) {
    processingError = err as Error;
    logger.error("Webhook handler error", { error: err, eventId: event.id, type: event.type });

    // Mark event as failed
    await db.webhookEvent.create({
      data: {
        error: processingError.message,
        eventId: event.id,
        eventType: event.type,
        status: 'failed',
      },
    });

    // Return 500 so Stripe retries
    return new Response("Webhook handler failed - will retry", { status: 500 });
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  logger.info("Checkout session completed", {
    customerId: session.customer,
    sessionId: session.id,
    subscriptionId: session.subscription,
  });

  if (!session.customer || !session.subscription) {
    logger.warn("Checkout completed without customer or subscription", { sessionId: session.id });
    return;
  }

  const customerId = getCustomerId(session.customer);

  // Fetch the full subscription to get all details
  const subscription = await stripe.subscriptions.retrieve(session.subscription as string);

  // Update user with Stripe customer ID if not already set
  const user = await db.user.findUnique({
    where: { stripeId: customerId },
  });

  if (user) {
    // Create or update subscription
    await handleSubscriptionUpdate(subscription);
  } else {
    logger.error("User not found for checkout session", { customerId, sessionId: session.id });
  }
}

async function handleCustomerUpdate(customer: Stripe.Customer) {
  if (!customer.email && !customer.metadata?.userId) {
    logger.warn("Customer update without email or userId metadata", { customerId: customer.id });
    return;
  }

  try {
    // Prefer metadata.userId for lookup, fallback to email
    const userId = customer.metadata?.userId;

    if (userId) {
      await db.user.update({
        data: { stripeId: customer.id },
        where: { id: userId },
      });
      logger.info("Updated user with Stripe customer ID via userId", {
        customerId: customer.id,
        userId,
      });
    } else if (customer.email) {
      await db.user.update({
        data: { stripeId: customer.id },
        where: { email: customer.email },
      });
      logger.info("Updated user with Stripe customer ID via email", {
        customerId: customer.id,
        email: customer.email,
      });
    }
  } catch (error) {
    logger.error("Failed to update user with Stripe ID", {
      customerId: customer.id,
      email: customer.email,
      error,
      userId: customer.metadata?.userId,
    });
    throw error; // Re-throw to trigger retry
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = getCustomerId(subscription.customer);

  const user = await db.user.findUnique({
    where: { stripeId: customerId },
  });

  if (!user) {
    logger.error("User not found for subscription", {
      customerId,
      subscriptionId: subscription.id,
    });
    throw new Error(`User not found for Stripe customer ${customerId}`);
  }

  const flags = getSubscriptionFlags(subscription);

  // Get plan name from subscription metadata or price
  let planName = subscription.metadata?.planName;
  if (!planName && subscription.items.data[0]) {
    const price = subscription.items.data[0].price;
    planName = price.nickname || price.product.toString();
  }

  try {
    await db.subscription.upsert({
      create: {
        ...flags,
        isLifetime: false,
        planName: planName || 'Pro',
        subscriptionId: subscription.id,
        userId: user.id,
      },
      update: {
        ...flags,
        planName: planName || undefined,
        subscriptionId: subscription.id,
      },
      where: { userId: user.id },
    });

    logger.info("Subscription updated", {
      ...flags,
      planName,
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
    throw error; // Re-throw to trigger retry
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = getCustomerId(subscription.customer);

  const user = await db.user.findUnique({
    where: { stripeId: customerId },
  });

  if (!user) {
    logger.warn("User not found for subscription deletion", {
      customerId,
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
    throw error; // Re-throw to trigger retry
  }
}

async function handleTrialWillEnd(subscription: Stripe.Subscription) {
  const customerId = getCustomerId(subscription.customer);

  const user = await db.user.findUnique({
    where: { stripeId: customerId },
  });

  if (!user) {
    logger.warn("User not found for trial ending notification", {
      customerId,
      subscriptionId: subscription.id,
    });
    return;
  }

  logger.info("Trial will end soon", {
    subscriptionId: subscription.id,
    trialEnd: subscription.trial_end,
    userId: user.id,
  });

  // TODO: Send email notification to user about trial ending
  // await sendEmail({
  //   to: user.email,
  //   subject: "Your trial is ending soon",
  //   ...
  // });
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = getCustomerId(invoice.customer!);

  logger.info("Payment succeeded", {
    amount: invoice.amount_paid,
    customerId,
    invoiceId: invoice.id,
  });

  // Optional: Send receipt email or notification
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = getCustomerId(invoice.customer!);

  logger.error("Payment failed", {
    attemptCount: invoice.attempt_count,
    customerId,
    invoiceId: invoice.id,
  });

  const user = await db.user.findUnique({
    where: { stripeId: customerId },
  });

  if (user) {
    // TODO: Send email notification about failed payment
    logger.info("Should notify user about failed payment", {
      email: user.email,
      userId: user.id,
    });
  }
}

async function handleInvoiceUpcoming(invoice: Stripe.Invoice) {
  const customerId = getCustomerId(invoice.customer!);

  logger.info("Invoice upcoming", {
    amount: invoice.amount_due,
    customerId,
    dueDate: invoice.due_date,
  });

  const user = await db.user.findUnique({
    where: { stripeId: customerId },
  });

  if (user) {
    // TODO: Send email notification about upcoming charge
    logger.info("Should notify user about upcoming charge", {
      amount: invoice.amount_due,
      email: user.email,
      userId: user.id,
    });
  }
}
