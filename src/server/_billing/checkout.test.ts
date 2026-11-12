import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";
import { startStripeStub, type StripeStub } from "~/test/helpers/stripeStub";

import { startCheckout, type StartCheckoutInput } from "./checkout";
import { LeaseBusyError } from "./lease";

const PRICES = {
  STRIPE_FOUNDING_ANNUAL_PRICE_ID: "price_founding_annual",
  STRIPE_FOUNDING_MONTHLY_PRICE_ID: "price_founding_monthly",
  STRIPE_STANDARD_ANNUAL_PRICE_ID: "price_standard_annual",
  STRIPE_STANDARD_MONTHLY_PRICE_ID: "price_standard_monthly",
};
const HOUR_MS = 60 * 60 * 1000;

let testDb: TestDb;
let stub: StripeStub;
let logged: Array<MockInstance<(...args: unknown[]) => void>>;

beforeAll(async () => {
  stub = await startStripeStub();
});

afterAll(async () => {
  await stub.close();
});

beforeEach(async () => {
  logged = (["error", "info", "log", "warn"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  testDb = await createTestDb();
  stub.reset();
});

afterEach(async () => {
  await testDb.close();
});

const start = (userId: string, overrides: Partial<StartCheckoutInput> = {}) =>
  startCheckout(testDb.db, stub.client, {
    baseUrl: "https://app.example.test",
    billingInterval: "monthly",
    prices: PRICES,
    successPath: "/app/settings?checkout=success",
    userId,
    ...overrides,
  });

const openSessions = () => [...stub.sessions.values()].filter((session) => session.status === "open");
const isExpire = (request: { method: string; path: string }) =>
  request.method === "POST" && request.path.endsWith("/expire");

describe("startCheckout", () => {
  it("does not create a second session when the earlier one could not be expired and may still be open", async () => {
    const user = await createTestUser(testDb.db);
    await start(user.id);
    // Stripe is failing on the expire call (an outage, not "already closed").
    stub.failWhen(isExpire, 503);

    await expect(start(user.id, { billingInterval: "annual" })).rejects.toThrow();

    expect(stub.sessions.size).toBe(1);
    expect(openSessions()).toHaveLength(1);
    // The lease was released on failure: the next attempt is not blocked.
    expect(await testDb.raw.billingLease.count()).toBe(0);
    stub.failWhen(null);
    expect(await start(user.id, { billingInterval: "annual" })).toMatchObject({ kind: "url" });
    expect(openSessions()).toHaveLength(1);
  });

  it("carries on when the session it could not expire is confirmed completed or expired", async () => {
    const user = await createTestUser(testDb.db);
    const first = await start(user.id);
    if (first.kind !== "url") throw new Error("expected a session");
    // Paid in the meantime: the stub (like Stripe) refuses to expire it.
    stub.onRequest((request) => {
      if (isExpire(request)) Object.assign(stub.sessions.get(first.sessionId) ?? {}, { status: "complete" });
    });

    const second = await start(user.id, { billingInterval: "annual" });

    expect(second.kind).toBe("url");
    expect(openSessions()).toHaveLength(1);
  });

  it("never logs the Stripe error or the session when an expire fails", async () => {
    const user = await createTestUser(testDb.db);
    const first = await start(user.id);
    if (first.kind !== "url") throw new Error("expected a session");
    stub.onRequest((request) => {
      if (isExpire(request)) Object.assign(stub.sessions.get(first.sessionId) ?? {}, { status: "expired" });
    });

    await start(user.id, { billingInterval: "annual" });

    const output = JSON.stringify(logged.flatMap((spy) => spy.mock.calls));
    expect(output).toContain("Checkout session was already closed");
    expect(output).not.toContain("checkout.stripe.test");
    expect(output).not.toContain(user.email);
  });

  it("does not hand out an open session that is about to expire", async () => {
    const user = await createTestUser(testDb.db);
    const first = await start(user.id);
    // 23 h 45 min later the session has 15 minutes left.
    const later = Date.now() + 23.75 * HOUR_MS;

    const second = await start(user.id, { now: () => later });

    expect(second).not.toEqual(first);
    expect([...stub.sessions.values()].map((session) => session.status)).toEqual(["expired", "open"]);
  });

  it("does not reuse an open session that was made for someone or something else", async () => {
    const user = await createTestUser(testDb.db);
    const first = await start(user.id);
    if (first.kind !== "url") throw new Error("expected a session");
    // Same customer and price, but not tagged as this user's purchase.
    Object.assign(stub.sessions.get(first.sessionId) ?? {}, { metadata: { priceId: "price_standard_monthly", userId: "someone_else" } });

    const second = await start(user.id);

    expect(second).toMatchObject({ kind: "url" });
    expect(second).not.toEqual(first);
    expect(openSessions()).toHaveLength(1);
  });

  it("gives up with LeaseBusyError, creating nothing, while another request holds the user's lease", async () => {
    const user = await createTestUser(testDb.db);
    const nowSeconds = Math.floor(Date.now() / 1000);
    await testDb.raw.billingLease.create({
      data: { expiresAt: nowSeconds + 60, holder: "another-request", key: `checkout:${user.id}` },
    });
    let clock = Date.now();
    const lease = { now: () => clock, sleep: async (ms: number) => void (clock += ms) };

    await expect(start(user.id, { lease })).rejects.toBeInstanceOf(LeaseBusyError);

    expect(stub.requests).toHaveLength(0);
    expect(await testDb.raw.billingLease.findUnique({ where: { key: `checkout:${user.id}` } })).toMatchObject({ holder: "another-request" });
  });

  it("takes over a lease whose holder died (it expired)", async () => {
    const user = await createTestUser(testDb.db);
    await testDb.raw.billingLease.create({
      data: { expiresAt: Math.floor(Date.now() / 1000) - 1, holder: "dead-request", key: `checkout:${user.id}` },
    });

    expect(await start(user.id)).toMatchObject({ kind: "url" });
    expect(await testDb.raw.billingLease.count()).toBe(0);
  });
});
