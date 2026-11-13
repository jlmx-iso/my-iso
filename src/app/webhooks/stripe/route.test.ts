import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import type * as PosthogModule from "~/server/_lib/posthog";
import { createTestDb, type TestDb } from "~/test/helpers/sqlite";
import { buildEvent, buildSubscription, signEvent } from "~/test/helpers/stripeStub";

const state = vi.hoisted(() => ({
  db: undefined as ExtendedPrismaClient | undefined,
  dbDown: false,
}));

vi.mock("~/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (!state.db) throw new Error("test database not ready");
        if (state.dbDown) return new Proxy({}, { get: () => () => Promise.reject(new Error("D1 unavailable")) });
        return Reflect.get(state.db, prop) as unknown;
      },
    },
  ),
}));
vi.mock("~/server/_lib/posthog", async (importOriginal) => ({
  ...(await importOriginal<typeof PosthogModule>()),
  captureServerException: vi.fn(),
}));

import { POST } from "./route";

// The secret the route verifies with (src/test/setup.ts).
const SECRET = "stripe_webhook_secret_placeholder";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  state.db = testDb.db;
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(() => {
  state.dbDown = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

function delivery(body: string, signature?: string) {
  return new NextRequest("http://localhost:3000/webhooks/stripe", {
    body,
    headers: signature ? { "stripe-signature": signature } : {},
    method: "POST",
  });
}

async function answer(response: Response) {
  return { result: ((await response.json()) as { result?: string }).result, status: response.status };
}

describe("POST /webhooks/stripe", () => {
  it("refuses a delivery without a signature", async () => {
    await expect(answer(await POST(delivery("{}")))).resolves.toEqual({ result: "missing_signature", status: 400 });
  });

  it("refuses a body that does not match its signature", async () => {
    const { body, signature } = await signEvent(buildEvent("customer.created", { id: "cus_1" }), SECRET);

    const response = await POST(delivery(body.replace("cus_1", "cus_2"), signature));

    await expect(answer(response)).resolves.toEqual({ result: "invalid_signature", status: 400 });
  });

  it("acknowledges a genuine event it does not handle", async () => {
    const { body, signature } = await signEvent(buildEvent("customer.created", { id: "cus_1" }), SECRET);

    await expect(answer(await POST(delivery(body, signature)))).resolves.toEqual({ result: "ignored", status: 200 });
  });

  it("asks Stripe to retry when the event cannot be recorded", async () => {
    state.dbDown = true;
    const event = buildEvent(
      "customer.subscription.updated",
      buildSubscription({ customer: "cus_1", id: "sub_1", status: "active" }),
    );
    const { body, signature } = await signEvent(event, SECRET);

    await expect(answer(await POST(delivery(body, signature)))).resolves.toEqual({ result: "error", status: 500 });
  });
});
