import { type NextRequest } from "next/server";

import { getStripe } from "~/server/_billing/stripe";
import { handleStripeWebhookRequest } from "~/server/_billing/webhookRequest";
import { db } from "~/server/db";

/**
 * Stripe webhook endpoint (POST /webhooks/stripe). The request checks (a
 * signature header must be present, the body is size-capped) are in
 * ~/server/_billing/webhookRequest.ts; the logic and the contract with
 * Stripe (status codes, events, API version) in ~/server/_billing/webhook.ts.
 */
export function POST(req: NextRequest): Promise<Response> {
  return handleStripeWebhookRequest({ db, getStripe }, req);
}
