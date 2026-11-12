import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "~/test/helpers/sqlite";
import { buildEvent, signEvent } from "~/test/helpers/stripeStub";

import { constructWebhookEvent } from "./stripe";
import type { WebhookDeps } from "./webhook";
import { handleStripeWebhookRequest, MAX_WEBHOOK_BODY_BYTES, readBodyWithLimit } from "./webhookRequest";

const SECRET = "whsec_test_0123456789abcdef0123456789abcdef";
const URL = "https://app.example.test/webhooks/stripe";

let testDb: TestDb;
let deps: WebhookDeps;
let verify: ReturnType<typeof vi.fn<NonNullable<WebhookDeps["verify"]>>>;

beforeEach(async () => {
  for (const method of ["error", "info", "log", "warn"] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined);
  }
  testDb = await createTestDb();
  verify = vi.fn((rawBody: string, signature: string) => constructWebhookEvent(rawBody, signature, SECRET));
  deps = {
    db: testDb.db,
    getStripe: () => {
      throw new Error("no event in these tests needs the API");
    },
    secretConfigured: () => true,
    verify,
  };
});

afterEach(async () => {
  await testDb.close();
});

/** A body sent in chunks with no Content-Length, counting what is pulled from it. */
function chunkedBody(chunks: string[]) {
  let pulled = 0;
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      const chunk = chunks[pulled];
      if (chunk === undefined) controller.close();
      else {
        pulled += 1;
        controller.enqueue(encoder.encode(chunk));
      }
    },
  }, { highWaterMark: 0 });
  return { cancelled: () => cancelled, pulled: () => pulled, stream };
}

const post = (body: BodyInit | null, headers: Record<string, string>) =>
  new Request(URL, { body, headers, method: "POST", ...(body instanceof ReadableStream ? { duplex: "half" } : {}) });

const resultOf = async (response: Response) => ((await response.json()) as { result: string }).result;

describe("handleStripeWebhookRequest", () => {
  it("handles a signed delivery", async () => {
    const { body, signature } = await signEvent(buildEvent("customer.created", { id: "cus_x", object: "customer" }), SECRET);

    const response = await handleStripeWebhookRequest(deps, post(body, { "stripe-signature": signature }));

    expect(response.status).toBe(200);
    expect(await resultOf(response)).toBe("ignored");
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("passes on exactly the bytes received, so the signature verifies for non-ASCII and chunked bodies", async () => {
    const event = buildEvent("customer.created", { id: "cus_x", name: "Zoë \u{1F4F7} 写真", object: "customer" });
    const { body, signature } = await signEvent(event, SECRET);
    // Split in the middle of a multi-byte character.
    const bytes = new TextEncoder().encode(body);
    const cut = bytes.findIndex((byte) => byte > 0x7f) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });

    const response = await handleStripeWebhookRequest(deps, post(stream, { "stripe-signature": signature }));

    expect(response.status).toBe(200);
    expect(verify.mock.calls[0]?.[0]).toBe(body);
  });

  it.each<Record<string, string>>([{}, { "stripe-signature": "" }, { "stripe-signature": "   " }])(
    "refuses a request without a signature header before reading the body (%j)",
    async (headers) => {
      const body = chunkedBody(["{}"]);

      const response = await handleStripeWebhookRequest(deps, post(body.stream, headers));

      expect(response.status).toBe(400);
      expect(await resultOf(response)).toBe("missing_signature");
      expect(body.pulled()).toBe(0);
      expect(verify).not.toHaveBeenCalled();
    },
  );

  it("refuses a declared Content-Length over the limit before reading the body", async () => {
    const body = chunkedBody(["{}"]);

    const response = await handleStripeWebhookRequest(
      deps,
      post(body.stream, { "content-length": String(MAX_WEBHOOK_BODY_BYTES + 1), "stripe-signature": "t=1,v1=abc" }),
    );

    expect(response.status).toBe(413);
    expect(await resultOf(response)).toBe("payload_too_large");
    expect(body.pulled()).toBe(0);
    expect(verify).not.toHaveBeenCalled();
  });

  it("accepts a body of exactly the limit and refuses one byte more", async () => {
    const atLimit = await handleStripeWebhookRequest(deps, post("x".repeat(64), { "stripe-signature": "t=1,v1=abc" }), 64);
    const over = await handleStripeWebhookRequest(deps, post("x".repeat(65), { "stripe-signature": "t=1,v1=abc" }), 64);

    // At the limit it is read and reaches verification (which rejects the made-up signature).
    expect(atLimit.status).toBe(400);
    expect(await resultOf(atLimit)).toBe("invalid_signature");
    expect(over.status).toBe(413);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("stops reading at the cap when Content-Length is absent (chunked) and the body is endless", async () => {
    const body = chunkedBody(Array.from({ length: 1000 }, () => "x".repeat(1024)));

    const response = await handleStripeWebhookRequest(deps, post(body.stream, { "stripe-signature": "t=1,v1=abc" }), 10 * 1024);

    expect(response.status).toBe(413);
    // Eleven 1 KiB chunks pass the 10 KiB cap; the other 989 are never pulled.
    expect(body.pulled()).toBeLessThanOrEqual(12);
    expect(body.cancelled()).toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it("stops reading at the cap when Content-Length understates the body", async () => {
    const body = chunkedBody(Array.from({ length: 100 }, () => "x".repeat(1024)));

    const response = await handleStripeWebhookRequest(
      deps,
      post(body.stream, { "content-length": "10", "stripe-signature": "t=1,v1=abc" }),
      4 * 1024,
    );

    expect(response.status).toBe(413);
    expect(body.pulled()).toBeLessThanOrEqual(6);
  });

  it("refuses a Content-Length that is not a number", async () => {
    const response = await handleStripeWebhookRequest(deps, post("{}", { "content-length": "lots", "stripe-signature": "t=1,v1=abc" }));

    expect(response.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers 500 when the signing secret is not configured, for a signed request", async () => {
    const { body, signature } = await signEvent(buildEvent("customer.created", { id: "cus_x", object: "customer" }), SECRET);

    const response = await handleStripeWebhookRequest(
      { ...deps, secretConfigured: () => false },
      post(body, { "stripe-signature": signature }),
    );

    expect(response.status).toBe(500);
    expect(await resultOf(response)).toBe("webhook_secret_missing");
  });
});

describe("readBodyWithLimit", () => {
  it("reads an empty and a missing body as empty text", async () => {
    expect(await readBodyWithLimit(post("", {}), 10)).toBe("");
    expect(await readBodyWithLimit(new Request(URL, { method: "POST" }), 10)).toBe("");
  });

  it("keeps a leading byte-order mark (the bytes are what was signed)", async () => {
    expect(await readBodyWithLimit(post("﻿{}", {}), 10)).toBe("﻿{}");
  });
});
