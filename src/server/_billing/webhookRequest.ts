import { handleStripeWebhook, type WebhookDeps } from "./webhook";

/**
 * The HTTP side of the Stripe webhook: what is checked BEFORE the body is
 * read, and how much of it is read at most.
 *
 * The endpoint is public and unauthenticated until the signature is
 * verified, and the signature covers the whole body, so the body has to be
 * buffered first. To keep that cheap for anyone who is not Stripe:
 *
 * 1. No `Stripe-Signature` header: 400 without reading anything.
 * 2. A `Content-Length` above the limit: 413 without reading anything.
 * 3. Otherwise the body is read with a hard cap, whatever `Content-Length`
 *    said (it can be absent with chunked encoding, or wrong): reading
 *    stops, and the request is answered 413, as soon as the cap is passed.
 */

/**
 * Larger than any event Stripe sends (its payloads are a few kilobytes; a
 * subscription or invoice with many lines, tens of kilobytes).
 */
export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

const json = (status: number, result: string): Response =>
  new Response(JSON.stringify({ result }), {
    headers: { "content-type": "application/json" },
    status,
  });

/**
 * The request body as text, or null when it is longer than `maxBytes`. The
 * stream is cancelled at that point: the rest is never buffered.
 */
export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Exactly the bytes received (no BOM stripping): the signature is over them.
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(body);
}

/** Handles `POST /webhooks/stripe`. */
export async function handleStripeWebhookRequest(
  deps: WebhookDeps,
  request: Request,
  maxBytes: number = MAX_WEBHOOK_BODY_BYTES,
): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature?.trim()) return json(400, "missing_signature");

  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) return json(400, "invalid_content_length");
    if (length > maxBytes) return json(413, "payload_too_large");
  }

  const rawBody = await readBodyWithLimit(request, maxBytes);
  if (rawBody === null) return json(413, "payload_too_large");

  const result = await handleStripeWebhook(deps, rawBody, signature);
  return new Response(result.body, {
    headers: { "content-type": "application/json" },
    status: result.status,
  });
}
