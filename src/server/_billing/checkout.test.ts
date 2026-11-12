import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";
import { startStripeStub, type StripeStub } from "~/test/helpers/stripeStub";
import { buildSubscription, type StubSubscriptionInput } from "~/test/helpers/stripeStub";

import { BillingStateUnknownError, startCheckout, type StartCheckoutInput } from "./checkout";
import { LeaseBusyError, LeaseLostError } from "./lease";

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

  /** A member whose Stripe customer exists. */
  async function createCustomerUser(customerId = "cus_alice") {
    const user = await createTestUser(testDb.db);
    await testDb.db.user.update({ data: { stripeId: customerId }, where: { id: user.id } });
    stub.customers.set(customerId, { id: customerId, metadata: { userId: user.id }, object: "customer" });
    return user;
  }

  const stripeHas = (input: StubSubscriptionInput) => stub.subscriptions.set(input.id, buildSubscription(input));

  it("reviews EVERY open session, not just the first page: none is left payable next to the new one", async () => {
    const user = await createCustomerUser();
    // Sessions for the other plan, more than one page of them.
    for (let i = 1; i <= 130; i += 1) {
      stub.sessions.set(`cs_old_${i}`, {
        customer: "cus_alice",
        expires_at: Math.floor(Date.now() / 1000) + 20 * 60 * 60,
        id: `cs_old_${i}`,
        metadata: { priceId: "price_standard_annual", userId: user.id },
        mode: "subscription",
        object: "checkout.session",
        status: "open",
        success_url: "https://app.example.test/app/settings?checkout=success",
        url: `https://checkout.stripe.test/c/pay/cs_old_${i}`,
      });
    }

    const result = await start(user.id);

    const lists = stub.requests.filter((request) => request.method === "GET" && request.path === "/v1/checkout/sessions");
    expect(lists.map((request) => request.params.starting_after)).toEqual([undefined, "cs_old_100"]);
    expect(stub.requests.filter(isExpire)).toHaveLength(130);
    expect(openSessions().map((session) => session.id)).toEqual([result.kind === "url" ? result.sessionId : null]);
  });

  it("creates nothing when it ran past its lease and another request took over", async () => {
    const user = await createCustomerUser();
    // While this request is still refreshing from Stripe, its lease expires
    // and another request of the same user takes it.
    stub.onRequest(async (request) => {
      if (request.path !== "/v1/subscriptions") return;
      await testDb.raw.billingLease.update({ data: { holder: "the-next-request" }, where: { key: `checkout:${user.id}` } });
    });

    const attempt = start(user.id);

    await expect(attempt).rejects.toBeInstanceOf(LeaseLostError);
    await expect(attempt).rejects.toBeInstanceOf(LeaseBusyError);
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    expect(openSessions()).toHaveLength(0);
    // The new holder's lease is not released by the one that lost it.
    expect(await testDb.raw.billingLease.findUnique({ where: { key: `checkout:${user.id}` } })).toMatchObject({ holder: "the-next-request" });
  });

  it("refuses, creating nothing, when the customer's subscriptions cannot all be read (an active one may be beyond the limit)", async () => {
    const user = await createCustomerUser();
    const T0 = 1_800_000_000;
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_active", status: "active" });
    for (let i = 1; i <= 4; i += 1) {
      stripeHas({ created: T0 + i * 86_400, customer: "cus_alice", id: `sub_newer_${i}`, status: "incomplete_expired" });
    }

    // Two pages of two: the active subscription is the fifth.
    const attempt = start(user.id, { sync: { listing: { maxPages: 2, pageSize: 2 } } });

    await expect(attempt).rejects.toBeInstanceOf(BillingStateUnknownError);
    expect(openSessions()).toHaveLength(0);
    expect(await testDb.db.subscription.count()).toBe(0);
    expect(logged[0]?.mock.calls.flat().join(" ")).toContain("more subscriptions than are read");

    // Read to the end, the active subscription is found and checkout is refused for the right reason.
    expect(await start(user.id)).toEqual({ kind: "subscription_exists" });
    expect(openSessions()).toHaveLength(0);
  });
});
