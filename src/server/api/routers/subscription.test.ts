import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorReason } from "~/_utils/errorReason";
import { setStripeClientForTests } from "~/server/_billing/stripe";
import { RateLimits } from "~/server/_utils/rateLimit";
import { reasonOf } from "~/server/api/reasonedError";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock, spendRateLimit } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";
import { buildSubscription, startStripeStub, type StripeStub } from "~/test/helpers/stripeStub";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/server/_lib/posthog", () => ({ captureEvent: vi.fn() }));

const envMock = vi.hoisted(() => {
  const env: Record<string, string | undefined> = {
    AUTH_SECRET: "test-secret-that-is-at-least-32-chars-long!!!",
    NEXT_PUBLIC_BASE_URL: "https://app.example.test",
    NODE_ENV: "test",
    STRIPE_FOUNDING_ANNUAL_PRICE_ID: "price_founding_annual",
    STRIPE_FOUNDING_MONTHLY_PRICE_ID: "price_founding_monthly",
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    STRIPE_STANDARD_ANNUAL_PRICE_ID: "price_standard_annual",
    STRIPE_STANDARD_MONTHLY_PRICE_ID: "price_standard_monthly",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  };
  return { env };
});
vi.mock("~/env", () => envMock);

import { subscriptionRouter } from "./subscription";

type TestUser = { email: string; id: string };

const DAY = 24 * 60 * 60;
const limiterClock = freezeRateLimitClock();

let stub: StripeStub;
let restoreStripe: () => void;
let testDb: TestDb;

beforeAll(async () => {
  stub = await startStripeStub();
  restoreStripe = setStripeClientForTests(stub.client);
});

afterAll(async () => {
  restoreStripe();
  await stub.close();
});

beforeEach(async () => {
  for (const method of ["error", "info", "log", "warn"] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined);
  }
  testDb = await createTestDb();
  stub.customers.clear();
  stub.subscriptions.clear();
  stub.sessions.clear();
  stub.portalSessions.length = 0;
  stub.requests.length = 0;
  envMock.env.STRIPE_STANDARD_MONTHLY_PRICE_ID = "price_standard_monthly";
});

afterEach(async () => {
  await testDb.close();
});

const as = (user: TestUser) => createDbCaller(subscriptionRouter, testDb.db, { user });

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );

const posts = (path: string) =>
  stub.requests.filter((request) => request.method === "POST" && request.path === path);

const storedCustomer = async (user: TestUser) =>
  (await testDb.db.user.findUniqueOrThrow({ where: { id: user.id } })).stripeId;

describe("createCheckoutSession", () => {
  it("creates the Stripe customer first, stores it, and tags customer, session and subscription with the user id", async () => {
    const user = await createTestUser(testDb.db);

    const result = await as(user).createCheckoutSession({ billingInterval: "monthly" });

    const [customerRequest] = posts("/v1/customers");
    const [sessionRequest] = posts("/v1/checkout/sessions");
    const customerId = await storedCustomer(user);
    expect(result.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(customerId).toMatch(/^cus_stub_/);
    expect(customerRequest?.params).toMatchObject({ email: user.email, "metadata[userId]": user.id });
    expect(customerRequest?.idempotencyKey).toBe(`my-iso:customer:${user.id}`);
    expect(sessionRequest?.params).toMatchObject({
      cancel_url: "https://app.example.test/app/settings?checkout=canceled",
      client_reference_id: user.id,
      customer: customerId,
      "line_items[0][price]": "price_standard_monthly",
      "line_items[0][quantity]": "1",
      "metadata[userId]": user.id,
      mode: "subscription",
      "subscription_data[metadata][userId]": user.id,
      success_url: "https://app.example.test/app/settings?checkout=success",
    });
    // No inline price, and no payment_method_types (removed from the API).
    const sent = Object.keys(sessionRequest?.params ?? {});
    expect(sent.filter((key) => key.includes("price_data") || key.includes("payment_method_types"))).toEqual([]);
  });

  it("charges the founding price to founding roles and the standard price to everyone else, whatever the client asks", async () => {
    const founding = await createTestUser(testDb.db, { role: "founding_member" });
    const standard = await createTestUser(testDb.db);

    await as(founding).createCheckoutSession({ billingInterval: "annual" });
    await as(standard).createCheckoutSession({ billingInterval: "annual" });

    expect(posts("/v1/checkout/sessions").map((request) => request.params["line_items[0][price]"])).toEqual([
      "price_founding_annual",
      "price_standard_annual",
    ]);
  });

  it("reuses the stored customer", async () => {
    const user = await createTestUser(testDb.db);
    await as(user).createCheckoutSession({ billingInterval: "monthly" });
    const firstCustomer = await storedCustomer(user);

    await as(user).createCheckoutSession({ billingInterval: "annual" });

    expect(posts("/v1/customers")).toHaveLength(1);
    expect(await storedCustomer(user)).toBe(firstCustomer);
  });

  it("gives two simultaneous first checkouts the same customer", async () => {
    const user = await createTestUser(testDb.db);

    await Promise.all([
      as(user).createCheckoutSession({ billingInterval: "monthly" }),
      as(user).createCheckoutSession({ billingInterval: "monthly" }),
    ]);

    expect(stub.customers.size).toBe(1);
    expect(await storedCustomer(user)).toBe([...stub.customers.keys()][0]);
  });

  it("expires an earlier unfinished session, so only one can ever be paid", async () => {
    const user = await createTestUser(testDb.db);

    await as(user).createCheckoutSession({ billingInterval: "monthly" });
    await as(user).createCheckoutSession({ billingInterval: "monthly" });

    expect([...stub.sessions.values()].map((session) => session.status)).toEqual(["expired", "open"]);
  });

  it("only returns to an allowed path", async () => {
    const user = await createTestUser(testDb.db);

    await as(user).createCheckoutSession({
      billingInterval: "monthly",
      successPath: "/app/onboarding/complete?plan=pro",
    });
    const refused = await errorOf(
      as(user).createCheckoutSession({
        billingInterval: "monthly",
        // @ts-expect-error not one of the allowed return paths
        successPath: "//evil.example/phish",
      }),
    );

    expect(posts("/v1/checkout/sessions")[0]?.params.success_url).toBe(
      "https://app.example.test/app/onboarding/complete?plan=pro",
    );
    expect(refused).toMatchObject({ code: "BAD_REQUEST" });
    expect(posts("/v1/checkout/sessions")).toHaveLength(1);
  });

  it.each(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"])(
    "refuses a second checkout while a %s subscription exists, and creates nothing",
    async (status) => {
      const user = await createTestUser(testDb.db);
      await as(user).createCheckoutSession({ billingInterval: "monthly" });
      const customerId = (await storedCustomer(user)) ?? "";
      // The first checkout was paid; the webhook has NOT arrived yet, so the
      // database knows nothing. Stripe does.
      stub.subscriptions.set("sub_1", buildSubscription({ customer: customerId, id: "sub_1", status }));
      const sessionsBefore = posts("/v1/checkout/sessions").length;

      const error = await errorOf(as(user).createCheckoutSession({ billingInterval: "annual" }));

      expect(error).toMatchObject({ code: "CONFLICT" });
      expect(reasonOf(error)).toBe(ErrorReason.SUBSCRIPTION_EXISTS);
      expect(posts("/v1/checkout/sessions")).toHaveLength(sessionsBefore);
      expect((await testDb.db.subscription.findUnique({ where: { userId: user.id } }))?.status).toBe(status);
    },
  );

  it("allows a new checkout after the previous subscription has ended, even if the database missed it", async () => {
    const user = await createTestUser(testDb.db);
    await as(user).createCheckoutSession({ billingInterval: "monthly" });
    const customerId = (await storedCustomer(user)) ?? "";
    stub.subscriptions.set("sub_1", buildSubscription({ customer: customerId, id: "sub_1", status: "active" }));
    await as(user).syncStatus();
    // Cancelled at Stripe; the webhook was lost.
    stub.subscriptions.set("sub_1", buildSubscription({ customer: customerId, endedAt: 1_800_500_000, id: "sub_1", status: "canceled" }));

    const result = await as(user).createCheckoutSession({ billingInterval: "monthly" });

    expect(result.url).toBeTruthy();
    expect((await testDb.db.subscription.findUnique({ where: { userId: user.id } }))?.status).toBe("canceled");
  });

  it("refuses checkout for a comped (lifetime) account", async () => {
    const user = await createTestUser(testDb.db);
    await testDb.db.subscription.create({
      data: {
        isActive: true, isCanceled: false, isExpired: false, isLifetime: true,
        isPaused: false, isPending: false, isTrial: false,
        status: "incomplete_expired", userId: user.id,
      },
    });

    const error = await errorOf(as(user).createCheckoutSession({ billingInterval: "monthly" }));

    expect(reasonOf(error)).toBe(ErrorReason.SUBSCRIPTION_EXISTS);
  });

  it("starts over with a new customer when the stored one was deleted at Stripe", async () => {
    const user = await createTestUser(testDb.db);
    await testDb.db.user.update({ data: { stripeId: "cus_deleted" }, where: { id: user.id } });

    const result = await as(user).createCheckoutSession({ billingInterval: "monthly" });

    expect(result.url).toBeTruthy();
    expect(await storedCustomer(user)).toMatch(/^cus_stub_/);
  });

  it("fails with billing_unavailable, creating nothing at Stripe, when the price is not configured", async () => {
    const user = await createTestUser(testDb.db);
    envMock.env.STRIPE_STANDARD_MONTHLY_PRICE_ID = undefined;

    const error = await errorOf(as(user).createCheckoutSession({ billingInterval: "monthly" }));

    expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(reasonOf(error)).toBe(ErrorReason.BILLING_UNAVAILABLE);
    expect(stub.requests).toHaveLength(0);
  });

  it("fails with billing_unavailable when Stripe is down", async () => {
    const user = await createTestUser(testDb.db);
    stub.failNext(1, 503);

    const error = await errorOf(as(user).createCheckoutSession({ billingInterval: "monthly" }));

    expect(reasonOf(error)).toBe(ErrorReason.BILLING_UNAVAILABLE);
    stub.failNext(0);
  });

  it("requires a signed-in user and is rate limited", async () => {
    const user = await createTestUser(testDb.db);
    const anonymous = createDbCaller(subscriptionRouter, testDb.db);

    await expect(anonymous.createCheckoutSession({ billingInterval: "monthly" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await spendRateLimit(testDb.db, RateLimits.BILLING_CHECKOUT, `user:${user.id}`, RateLimits.BILLING_CHECKOUT.limit - 1);
    await as(user).createCheckoutSession({ billingInterval: "monthly" });
    await expect(as(user).createCheckoutSession({ billingInterval: "monthly" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
});

describe("createPortalSession", () => {
  it("opens the portal for the user's customer, returning to settings", async () => {
    const user = await createTestUser(testDb.db);
    await as(user).createCheckoutSession({ billingInterval: "monthly" });

    const result = await as(user).createPortalSession();

    expect(result.url).toMatch(/^https:\/\/billing\.stripe\.test\//);
    expect(stub.portalSessions[0]).toMatchObject({
      customer: await storedCustomer(user),
      return_url: "https://app.example.test/app/settings",
    });
  });

  it("answers no_billing_account for someone who never subscribed", async () => {
    const user = await createTestUser(testDb.db);

    const error = await errorOf(as(user).createPortalSession());

    expect(error).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(reasonOf(error)).toBe(ErrorReason.NO_BILLING_ACCOUNT);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("getStatus / syncStatus", () => {
  it("returns null for someone without a subscription", async () => {
    const user = await createTestUser(testDb.db);

    expect(await as(user).getStatus()).toBeNull();
    expect(await as(user).syncStatus()).toBeNull();
  });

  it("re-derives the state from Stripe and reports plan, renewal and access", async () => {
    const user = await createTestUser(testDb.db, { role: "founding_member" });
    await as(user).createCheckoutSession({ billingInterval: "annual" });
    const customerId = (await storedCustomer(user)) ?? "";
    const now = Math.floor(Date.now() / 1000);
    stub.subscriptions.set(
      "sub_1",
      buildSubscription({
        customer: customerId,
        id: "sub_1",
        interval: "year",
        periodEnd: now + 300 * DAY,
        periodStart: now - 65 * DAY,
        priceId: "price_founding_annual",
        status: "active",
      }),
    );

    const synced = await as(user).syncStatus();

    expect(synced).toMatchObject({
      accessEndsAt: null,
      cancelAtPeriodEnd: false,
      canStartCheckout: false,
      currentPeriodEnd: new Date((now + 300 * DAY) * 1000),
      hasProAccess: true,
      interval: "year",
      isActive: true,
      isCanceled: false,
      isPastDue: false,
      plan: "founding",
      renewsAt: new Date((now + 300 * DAY) * 1000),
      status: "active",
    });
    expect(await as(user).getStatus()).toEqual(synced);
  });

  it("shows a scheduled cancellation: access until the date, no renewal", async () => {
    const user = await createTestUser(testDb.db);
    await as(user).createCheckoutSession({ billingInterval: "monthly" });
    const customerId = (await storedCustomer(user)) ?? "";
    const now = Math.floor(Date.now() / 1000);
    stub.subscriptions.set(
      "sub_1",
      buildSubscription({ cancelAtPeriodEnd: true, customer: customerId, id: "sub_1", periodEnd: now + 9 * DAY, periodStart: now - 21 * DAY, status: "active" }),
    );

    const status = await as(user).syncStatus();

    expect(status).toMatchObject({
      accessEndsAt: new Date((now + 9 * DAY) * 1000),
      cancelAt: new Date((now + 9 * DAY) * 1000),
      cancelAtPeriodEnd: true,
      expiresAt: new Date((now + 9 * DAY) * 1000),
      hasProAccess: true,
      isCanceled: true,
      renewsAt: null,
    });
  });

  it("shows a past-due subscription as still having access, flagged", async () => {
    const user = await createTestUser(testDb.db);
    await as(user).createCheckoutSession({ billingInterval: "monthly" });
    const customerId = (await storedCustomer(user)) ?? "";
    const now = Math.floor(Date.now() / 1000);
    stub.subscriptions.set(
      "sub_1",
      buildSubscription({ customer: customerId, id: "sub_1", periodStart: now - DAY, status: "past_due" }),
    );

    expect(await as(user).syncStatus()).toMatchObject({
      hasProAccess: true,
      isPastDue: true,
      renewsAt: null,
      status: "past_due",
    });
  });

  it("prefers the live subscription over an older cancelled one", async () => {
    const user = await createTestUser(testDb.db);
    await as(user).createCheckoutSession({ billingInterval: "monthly" });
    const customerId = (await storedCustomer(user)) ?? "";
    stub.subscriptions.set("sub_old", buildSubscription({ created: 1_700_000_000, customer: customerId, id: "sub_old", status: "canceled" }));
    stub.subscriptions.set("sub_live", buildSubscription({ created: 1_750_000_000, customer: customerId, id: "sub_live", status: "active" }));
    stub.subscriptions.set("sub_newer_dead", buildSubscription({ created: 1_760_000_000, customer: customerId, id: "sub_newer_dead", status: "incomplete_expired" }));

    await as(user).syncStatus();

    expect(await testDb.db.subscription.findUnique({ where: { userId: user.id } })).toMatchObject({
      status: "active",
      subscriptionId: "sub_live",
    });
  });

  it("rate limits syncStatus", async () => {
    const user = await createTestUser(testDb.db);
    for (let i = 0; i < RateLimits.BILLING_SYNC.limit; i++) await as(user).syncStatus();

    await expect(as(user).syncStatus()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    limiterClock.advance(RateLimits.BILLING_SYNC.windowSeconds);
    expect(await as(user).syncStatus()).toBeNull();
  });
});
