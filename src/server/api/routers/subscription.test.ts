import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorReason } from "~/_utils/errorReason";
import type * as StripeModule from "~/server/_billing/stripe";
import { RateLimits } from "~/server/_utils/rateLimit";
import { reasonOf } from "~/server/api/reasonedError";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock, spendRateLimit } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";
import { buildInvoice, buildSubscription, startStripeStub, type StripeStub } from "~/test/helpers/stripeStub";

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

// The router's Stripe client is the real SDK pointed at the local stub.
const stripeRef = vi.hoisted((): { stub: { client: unknown } | null } => ({ stub: null }));
vi.mock("~/server/_billing/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof StripeModule>()),
  getStripe: () => {
    if (!stripeRef.stub) throw new Error("the Stripe stub is not running");
    return stripeRef.stub.client;
  },
}));

import { subscriptionRouter } from "./subscription";

type TestUser = { email: string; id: string };

const DAY = 24 * 60 * 60;
const limiterClock = freezeRateLimitClock();

let stub: StripeStub;
let testDb: TestDb;

beforeAll(async () => {
  stub = await startStripeStub();
  stripeRef.stub = stub;
});

afterAll(async () => {
  stripeRef.stub = null;
  await stub.close();
});

beforeEach(async () => {
  for (const method of ["error", "info", "log", "warn"] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined);
  }
  testDb = await createTestDb();
  stub.reset();
  // Stripe's clock moves a second with every response: two readings never
  // bear the same second by accident (subscriptionStore.test.ts covers that).
  let stripeNow = Date.now();
  stub.setNow(() => new Date((stripeNow += 1000)));
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

  it("hands out the session that is already open for the same purchase instead of a second one", async () => {
    const user = await createTestUser(testDb.db);

    const first = await as(user).createCheckoutSession({ billingInterval: "monthly" });
    const second = await as(user).createCheckoutSession({ billingInterval: "monthly" });

    expect(second.url).toBe(first.url);
    expect([...stub.sessions.values()].map((session) => session.status)).toEqual(["open"]);
    expect(posts("/v1/checkout/sessions")).toHaveLength(1);
  });

  it("expires an earlier unfinished session for a different plan or return path, so only one can ever be paid", async () => {
    const user = await createTestUser(testDb.db);

    await as(user).createCheckoutSession({ billingInterval: "monthly" });
    await as(user).createCheckoutSession({ billingInterval: "annual" });
    await as(user).createCheckoutSession({ billingInterval: "annual", successPath: "/app/onboarding/complete?plan=pro" });

    expect([...stub.sessions.values()].map((session) => session.status)).toEqual(["expired", "expired", "open"]);
  });

  it("two simultaneous checkout starts produce ONE payable session", async () => {
    const user = await createTestUser(testDb.db);

    const [first, second] = await Promise.all([
      as(user).createCheckoutSession({ billingInterval: "monthly" }),
      as(user).createCheckoutSession({ billingInterval: "monthly" }),
    ]);

    expect(second.url).toBe(first.url);
    expect([...stub.sessions.values()].filter((session) => session.status === "open")).toHaveLength(1);
    expect(posts("/v1/checkout/sessions")).toHaveLength(1);
    expect(await testDb.raw.billingLease.count()).toBe(0);
  });

  it("two simultaneous starts for different plans leave one payable session", async () => {
    const user = await createTestUser(testDb.db);

    await Promise.all([
      as(user).createCheckoutSession({ billingInterval: "monthly" }),
      as(user).createCheckoutSession({ billingInterval: "annual" }),
    ]);

    expect([...stub.sessions.values()].filter((session) => session.status === "open")).toHaveLength(1);
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

  it("refuses checkout, without a dead end, for a status this release does not know", async () => {
    const user = await createTestUser(testDb.db);
    await as(user).createCheckoutSession({ billingInterval: "monthly" });
    const customerId = (await storedCustomer(user)) ?? "";
    stub.subscriptions.set("sub_1", buildSubscription({ customer: customerId, id: "sub_1", status: "some_future_status" }));

    const error = await errorOf(as(user).createCheckoutSession({ billingInterval: "monthly" }));

    expect(reasonOf(error)).toBe(ErrorReason.SUBSCRIPTION_EXISTS);
    // The open session from before must not be payable on top of it.
    expect([...stub.sessions.values()].map((session) => session.status)).toEqual(["expired"]);
    expect(await as(user).getStatus()).toMatchObject({
      billingIssue: "unknown_status",
      canStartCheckout: false,
      hasProAccess: false,
      status: "some_future_status",
    });
    expect((await as(user).createPortalSession()).url).toMatch(/^https:\/\/billing\.stripe\.test\//);
  });

  it("refuses checkout while a second, unfinished subscription exists that the row does not show", async () => {
    const user = await createTestUser(testDb.db);
    await as(user).createCheckoutSession({ billingInterval: "monthly" });
    const customerId = (await storedCustomer(user)) ?? "";
    const now = Math.floor(Date.now() / 1000);
    // Cancelled with paid time left (that is what the row shows), and a new
    // subscription whose first payment is still being confirmed.
    stub.subscriptions.set("sub_old", buildSubscription({ cancellationReason: "cancellation_requested", created: now - 10 * DAY, customer: customerId, id: "sub_old", periodEnd: now + 20 * DAY, periodStart: now - 10 * DAY, status: "canceled" }));
    stub.subscriptions.set("sub_new", buildSubscription({ created: now - 60, customer: customerId, id: "sub_new", status: "incomplete" }));

    const error = await errorOf(as(user).createCheckoutSession({ billingInterval: "monthly" }));

    expect(reasonOf(error)).toBe(ErrorReason.SUBSCRIPTION_EXISTS);
    expect(await as(user).getStatus()).toMatchObject({ hasProAccess: true, status: "canceled" });
  });

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

  it.each([
    ["unpaid", {}, "payment_failed"],
    ["paused", {}, "paused"],
    ["incomplete", {}, "incomplete"],
    // Past due for longer than the grace window.
    ["past_due", { invoiceCreatedDaysAgo: 30 }, "payment_failed"],
  ] as const)(
    "a lapsed subscriber (%s) is not left at a dead end: no checkout, no access, but the portal opens",
    async (status, options, billingIssue) => {
      const user = await createTestUser(testDb.db);
      await as(user).createCheckoutSession({ billingInterval: "monthly" });
      const customerId = (await storedCustomer(user)) ?? "";
      const now = Math.floor(Date.now() / 1000);
      stub.subscriptions.set("sub_1", buildSubscription({ customer: customerId, id: "sub_1", status }));
      if ("invoiceCreatedDaysAgo" in options) {
        stub.invoices.set(
          "in_sub_1",
          buildInvoice({ created: now - options.invoiceCreatedDaysAgo * DAY, customer: customerId, id: "in_sub_1", status: "open", subscriptionId: "sub_1" }),
        );
      }

      const view = await as(user).syncStatus();

      expect(view).toMatchObject({ billingIssue, canStartCheckout: false, hasProAccess: false, status });
      const portal = await as(user).createPortalSession();
      expect(portal.url).toMatch(/^https:\/\/billing\.stripe\.test\//);
      expect(stub.portalSessions.at(-1)).toMatchObject({ customer: customerId });
    },
  );

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
    await spendRateLimit(testDb.db, RateLimits.BILLING_SYNC, `user:${user.id}`, RateLimits.BILLING_SYNC.limit - 1);
    expect(await as(user).syncStatus()).toBeNull();

    await expect(as(user).syncStatus()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    limiterClock.advance(RateLimits.BILLING_SYNC.windowSeconds);
    expect(await as(user).syncStatus()).toBeNull();
  });
});

describe("resyncFromStripe (admin)", () => {
  const legacyFlags = { isActive: false, isCanceled: false, isExpired: false, isLifetime: false, isPaused: false, isPending: false, isTrial: false };

  /** A row as the migration back-fills it: never read from Stripe. */
  async function legacyRow(options: { customerId: string | null; status: string; stripeStatus: string; subscriptionId: string }) {
    const user = await createTestUser(testDb.db);
    const customer = options.customerId ?? `cus_unlinked_${options.subscriptionId}`;
    stub.customers.set(customer, { id: customer, metadata: {}, object: "customer" });
    if (options.customerId) {
      await testDb.db.user.update({ data: { stripeId: options.customerId }, where: { id: user.id } });
    }
    stub.subscriptions.set(options.subscriptionId, buildSubscription({ customer, id: options.subscriptionId, status: options.stripeStatus }));
    await testDb.db.subscription.create({
      data: { ...legacyFlags, isActive: options.status === "active", status: options.status, subscriptionId: options.subscriptionId, userId: user.id },
    });
    return user;
  }

  const statusOf = async (user: TestUser) =>
    (await testDb.db.subscription.findUniqueOrThrow({ where: { userId: user.id } })).status;

  it("is refused for anyone who is not a founder or ambassador", async () => {
    const member = await createTestUser(testDb.db);
    const anonymous = createDbCaller(subscriptionRouter, testDb.db);

    await expect(as(member).resyncFromStripe({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(anonymous.resyncFromStripe({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(stub.requests).toHaveLength(0);
  });

  it("brings legacy rows up to date in bounded batches, and can be run again", async () => {
    const admin = await createTestUser(testDb.db, { role: "founder" });
    // The migration guessed "active"; Stripe says it was cancelled long ago.
    const lapsed = await legacyRow({ customerId: "cus_a", status: "active", stripeStatus: "canceled", subscriptionId: "sub_a" });
    // Guessed "unpaid" (the old release cleared isActive on a failed invoice); Stripe says active.
    const paying = await legacyRow({ customerId: "cus_b", status: "unpaid", stripeStatus: "active", subscriptionId: "sub_b" });
    // No customer id stored on the user: cannot be attributed, left alone.
    const unlinked = await legacyRow({ customerId: null, status: "active", stripeStatus: "active", subscriptionId: "sub_c" });
    // A comped account is never touched.
    const comped = await createTestUser(testDb.db);
    await testDb.db.subscription.create({ data: { ...legacyFlags, isLifetime: true, status: "incomplete_expired", userId: comped.id } });

    const outcomes: Record<string, number> = {};
    let cursor: string | null | undefined;
    let batches = 0;
    do {
      const batch = await as(admin).resyncFromStripe({ cursor, limit: 2 });
      expect(batch.processed).toBeLessThanOrEqual(2);
      for (const [outcome, count] of Object.entries(batch.outcomes)) outcomes[outcome] = (outcomes[outcome] ?? 0) + count;
      cursor = batch.nextCursor;
      batches += 1;
    } while (cursor);

    expect(batches).toBe(2);
    expect(outcomes).toEqual({ applied: 2, unknown_customer: 1 });
    expect(await statusOf(lapsed)).toBe("canceled");
    expect(await statusOf(paying)).toBe("active");
    expect(await as(paying).getStatus()).toMatchObject({ hasProAccess: true, isActive: true });
    expect(await testDb.db.subscription.findUniqueOrThrow({ where: { userId: unlinked.id } })).toMatchObject({ status: "active", stripeSyncedAt: null });

    // Again: only the row that could not be attributed is still pending.
    const again = await as(admin).resyncFromStripe({});
    expect(again).toEqual({ nextCursor: null, outcomes: { unknown_customer: 1 }, processed: 1 });
    // "all" also revisits the rows that are already in step.
    expect((await as(admin).resyncFromStripe({ scope: "all" })).processed).toBe(3);
  });

  it("picks up rows the previous release wrote during the deploy overlap (flags that contradict the status)", async () => {
    const admin = await createTestUser(testDb.db, { role: "ambassador" });
    const user = await legacyRow({ customerId: "cus_a", status: "active", stripeStatus: "active", subscriptionId: "sub_a" });
    await as(admin).resyncFromStripe({});
    // The previous release handles a cancellation: it only knows the flags.
    await testDb.db.subscription.update({ data: { isActive: false, isExpired: true }, where: { userId: user.id } });
    stub.subscriptions.set("sub_a", buildSubscription({ customer: "cus_a", id: "sub_a", status: "canceled" }));

    const batch = await as(admin).resyncFromStripe({});

    expect(batch).toMatchObject({ outcomes: { applied: 1 }, processed: 1 });
    expect(await statusOf(user)).toBe("canceled");
    expect((await as(admin).resyncFromStripe({})).processed).toBe(0);
  });

  it("counts a row that fails and carries on with the rest", async () => {
    const admin = await createTestUser(testDb.db, { role: "founder" });
    await legacyRow({ customerId: "cus_a", status: "active", stripeStatus: "canceled", subscriptionId: "sub_a" });
    const second = await legacyRow({ customerId: "cus_b", status: "unpaid", stripeStatus: "active", subscriptionId: "sub_b" });
    stub.failWhen((request) => request.params.customer === "cus_a");

    const batch = await as(admin).resyncFromStripe({});

    expect(batch.processed).toBe(2);
    expect(Object.values(batch.outcomes).reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(batch.outcomes.failed).toBe(1);
    expect(await statusOf(second)).toBe("active");
  });
});
