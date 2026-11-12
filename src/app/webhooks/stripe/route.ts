import { type NextRequest } from "next/server";

import { getStripe } from "~/server/_billing/stripe";
import { handleStripeWebhook } from "~/server/_billing/webhook";
import { db } from "~/server/db";

/**
 * Stripe webhook endpoint (POST /webhooks/stripe). All of the logic, and the
 * contract with Stripe (status codes, events, API version), is in
 * ~/server/_billing/webhook.ts.
 */
export async function POST(req: NextRequest): Promise<Response> {
  // The raw text, never parsed JSON: the signature is over these bytes.
  const rawBody = await req.text();
  const result = await handleStripeWebhook(
    { db, getStripe },
    rawBody,
    req.headers.get("stripe-signature"),
  );
  return new Response(result.body, {
    headers: { "content-type": "application/json" },
    status: result.status,
  });
}
