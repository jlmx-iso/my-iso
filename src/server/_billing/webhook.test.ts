import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";
import {
  buildCharge,
  buildDispute,
  buildEvent,
  buildInvoice,
  buildInvoicePayment,
  buildRefund,
  buildSubscription,
  signEvent,
  startStripeStub,
  type StripeStub,
  type StubSubscriptionInput,
} from "~/test/helpers/stripeStub";

import { entitlementsFor } from "./entitlements";
import { CLAIM_LEASE_SECONDS } from "./eventLog";
import { MAX_DISPUTED_CHARGES, MAX_KNOWN_DISPUTES_REREAD, MAX_STANDING_STRIPE_CALLS } from "./paymentStanding";
import { constructWebhookEvent } from "./stripe";
import { subscriptionStateFromStripe } from "./subscriptionState";
import { applySubscriptionState } from "./subscriptionStore";
import { handleStripeWebhook, type WebhookDeps } from "./webhook";

/** The code under test logs what it refuses; keep the test output readable. */
function silenceConsole() {
  for (const method of ["error", "info", "log", "warn"] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined);
  }
}

const SECRET = "whsec_test_0123456789abcdef0123456789abcdef";
const DAY = 24 * 60 * 60;
const T0 = 1_800_000_000; // subscription start, Unix seconds

let testDb: TestDb;
let stub: StripeStub;
let deps: WebhookDeps;

beforeAll(async () => {
  stub = await startStripeStub();
});

afterAll(async () => {
  await stub.close();
});

beforeEach(async () => {
  silenceConsole();
  testDb = await createTestDb();
  stub.reset();
  // Stripe's clock moves a second with every response, so that two readings
  // never bear the same second by accident (that case has its own tests in
  // subscriptionStore.test.ts) and no test has to wait one out.
  let stripeNow = Date.now();
  stub.setNow(() => new Date((stripeNow += 1000)));
  deps = {
    db: testDb.db,
    getStripe: () => stub.client,
    verify: (rawBody, signature) => constructWebhookEvent(rawBody, signature, SECRET),
  };
});

afterEach(async () => {
  await testDb.close();
});

/** Signs and delivers an event the way Stripe would. */
async function deliver(event: Record<string, unknown>) {
  const { body, signature } = await signEvent(event, SECRET);
  const response = await handleStripeWebhook(deps, body, signature);
  return { ...response, result: (JSON.parse(response.body) as { result: string }).result };
}

/** A member who has started checkout: their Stripe customer id is stored. */
async function createCustomerUser(customerId = "cus_alice") {
  const user = await createTestUser(testDb.db);
  await testDb.db.user.update({ data: { stripeId: customerId }, where: { id: user.id } });
  stub.customers.set(customerId, { id: customerId, metadata: { userId: user.id }, object: "customer" });
  return user;
}

/** Sets what the Stripe API currently says about a subscription. */
function stripeHas(input: StubSubscriptionInput) {
  const subscription = buildSubscription(input);
  stub.subscriptions.set(input.id, subscription);
  return subscription;
}

const subscriptionRow = (userId: string) =>
  testDb.db.subscription.findUnique({ where: { userId } });

const apiCalls = () => stub.requests.filter((request) => request.method === "GET").length;

describe("signature verification", () => {
  it("accepts a payload signed with the endpoint secret", async () => {
    const event = buildEvent("customer.created", { id: "cus_x", object: "customer" });
    const { body, signature } = await signEvent(event, SECRET);

    const response = await handleStripeWebhook(deps, body, signature);

    expect(response.status).toBe(200);
  });

  it("rejects a tampered body with 400 and does nothing", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const event = buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" }));
    const { body, signature } = await signEvent(event, SECRET);

    const response = await handleStripeWebhook(deps, body.replace("sub_1", "sub_2"), signature);

    expect(response.status).toBe(400);
    expect(await subscriptionRow(user.id)).toBeNull();
    expect(await testDb.raw.stripeEvent.count()).toBe(0);
    expect(stub.requests).toHaveLength(0);
  });

  it("rejects a payload signed with another secret", async () => {
    const event = buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_a", id: "sub_1", status: "active" }));
    const { body, signature } = await signEvent(event, "whsec_someone_elses_secret");

    expect((await handleStripeWebhook(deps, body, signature)).status).toBe(400);
  });

  it("rejects a missing signature header", async () => {
    const response = await handleStripeWebhook(deps, "{}", null);

    expect(response.status).toBe(400);
  });

  it("rejects a replayed delivery whose timestamp is outside the tolerance", async () => {
    const event = buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_a", id: "sub_1", status: "active" }));
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    const { body, signature } = await signEvent(event, SECRET, tenMinutesAgo);

    expect((await handleStripeWebhook(deps, body, signature)).status).toBe(400);
  });

  it("answers 500, not 400, when this server has no signing secret, and reports it once", async () => {
    const errors = vi.spyOn(console, "error");
    const event = buildEvent("customer.created", { id: "cus_x", object: "customer" });
    const { body, signature } = await signEvent(event, SECRET);
    const misconfigured = { ...deps, secretConfigured: () => false };

    const first = await handleStripeWebhook(misconfigured, body, signature);
    const second = await handleStripeWebhook(misconfigured, body, signature);

    expect([first.status, second.status]).toEqual([500, 500]);
    expect(JSON.parse(first.body)).toEqual({ result: "webhook_secret_missing" });
    const reports = errors.mock.calls.filter((call) => String(call[0]).includes("STRIPE_WEBHOOK_SECRET"));
    expect(reports).toHaveLength(1);
    expect(await testDb.raw.stripeEvent.count()).toBe(0);
  });

  it("answers 500 (retry) rather than 400 when verification itself cannot run", async () => {
    const event = buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_a", id: "sub_1", status: "active" }));
    const { body, signature } = await signEvent(event, SECRET);

    const response = await handleStripeWebhook(
      { ...deps, verify: () => Promise.reject(new Error("no signing secret configured")) },
      body,
      signature,
    );

    expect(response.status).toBe(500);
  });
});

describe("checkout.session.completed", () => {
  it("stores the customer on the user and the subscription state read from Stripe", async () => {
    // The user's customer id is not stored yet: the session's reference is
    // what ties the customer to the user.
    const user = await createTestUser(testDb.db);
    stub.customers.set("cus_new", { id: "cus_new", metadata: {}, object: "customer" });
    stripeHas({
      customer: "cus_new",
      created: T0,
      id: "sub_1",
      interval: "year",
      metadata: { userId: user.id },
      periodEnd: T0 + 365 * DAY,
      priceId: "price_unknown_to_this_app",
      status: "active",
    });

    const response = await deliver(
      buildEvent("checkout.session.completed", {
        client_reference_id: user.id,
        customer: "cus_new",
        // Deliberately someone else's address: email is never used.
        customer_details: { email: "someone-else@example.com" },
        id: "cs_test_1",
        metadata: { userId: user.id },
        mode: "subscription",
        object: "checkout.session",
        subscription: "sub_1",
      }),
    );

    expect(response).toMatchObject({ result: "applied", status: 200 });
    expect((await testDb.db.user.findUniqueOrThrow({ where: { id: user.id } })).stripeId).toBe("cus_new");
    expect(await subscriptionRow(user.id)).toMatchObject({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date((T0 + 365 * DAY) * 1000),
      currentPeriodStart: new Date(T0 * 1000),
      interval: "year",
      plan: null,
      priceId: "price_unknown_to_this_app",
      status: "active",
      stripeCustomerId: "cus_new",
      subscriptionId: "sub_1",
    });
  });

  it("ignores a session that is not for a subscription", async () => {
    const user = await createCustomerUser();

    const response = await deliver(
      buildEvent("checkout.session.completed", {
        client_reference_id: user.id,
        customer: "cus_alice",
        id: "cs_test_2",
        mode: "payment",
        object: "checkout.session",
        subscription: null,
      }),
    );

    expect(response).toMatchObject({ result: "not_a_subscription", status: 200 });
    expect(await subscriptionRow(user.id)).toBeNull();
  });
});

describe("resolving the user", () => {
  it("uses the stored customer id first", async () => {
    const user = await createCustomerUser("cus_alice");
    // Metadata naming another (non-existent) user must not win over the stored id.
    stripeHas({ customer: "cus_alice", id: "sub_1", metadata: { userId: "someone-else" }, status: "active" });

    const response = await deliver(
      buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" })),
    );

    expect(response.result).toBe("applied");
    expect((await subscriptionRow(user.id))?.subscriptionId).toBe("sub_1");
  });

  it("falls back to metadata.userId on the subscription, and remembers the customer", async () => {
    const user = await createTestUser(testDb.db);
    stripeHas({ customer: "cus_meta", id: "sub_1", metadata: { userId: user.id }, status: "active" });

    const response = await deliver(
      buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_meta", id: "sub_1", status: "active" })),
    );

    expect(response.result).toBe("applied");
    expect((await testDb.db.user.findUniqueOrThrow({ where: { id: user.id } })).stripeId).toBe("cus_meta");
  });

  it("falls back to metadata.userId on the customer", async () => {
    const user = await createTestUser(testDb.db);
    stub.customers.set("cus_meta", { id: "cus_meta", metadata: { userId: user.id }, object: "customer" });
    stripeHas({ customer: "cus_meta", id: "sub_1", status: "trialing" });

    const response = await deliver(
      buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_meta", id: "sub_1", status: "trialing" })),
    );

    expect(response.result).toBe("applied");
    expect((await subscriptionRow(user.id))?.status).toBe("trialing");
  });

  it("acknowledges an event for an unknown customer with 200 and stores no subscription", async () => {
    const bystander = await createTestUser(testDb.db, { email: "shared@example.com" });
    // Same email as a user here, but neither a stored id nor metadata.
    stub.customers.set("cus_stranger", { email: "shared@example.com", id: "cus_stranger", metadata: {}, object: "customer" });
    stripeHas({ customer: "cus_stranger", id: "sub_x", status: "active" });

    const response = await deliver(
      buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_stranger", id: "sub_x", status: "active" })),
    );

    expect(response).toMatchObject({ result: "unknown_customer", status: 200 });
    expect(await testDb.db.subscription.count()).toBe(0);
    expect((await testDb.db.user.findUniqueOrThrow({ where: { id: bystander.id } })).stripeId).toBeNull();
    // Handled for good: a redelivery is a duplicate, not another lookup.
    expect(await testDb.raw.stripeEvent.count({ where: { status: "processed" } })).toBe(1);
  });

  it("acknowledges an event for a subscription Stripe no longer has", async () => {
    const response = await deliver(
      buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_gone", id: "sub_gone", status: "active" })),
    );

    expect(response).toMatchObject({ result: "subscription_missing", status: 200 });
  });
});

describe("duplicate deliveries", () => {
  it("handles an event once: the second delivery is acknowledged without touching Stripe or the row", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const event = buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" }));

    const first = await deliver(event);
    const callsAfterFirst = apiCalls();
    const rowAfterFirst = await subscriptionRow(user.id);
    // Stripe's state has moved on, to prove the duplicate is not re-processed.
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "past_due" });
    const second = await deliver(event);

    expect(first).toMatchObject({ result: "applied", status: 200 });
    expect(second).toMatchObject({ result: "duplicate", status: 200 });
    expect(apiCalls()).toBe(callsAfterFirst);
    expect(await subscriptionRow(user.id)).toEqual(rowAfterFirst);
    expect(await testDb.raw.stripeEvent.count()).toBe(1);
  });

  it("lets exactly one of two simultaneous deliveries handle the event", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const event = buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" }));

    const responses = await Promise.all([deliver(event), deliver(event)]);

    const results = responses.map((response) => response.result).sort();
    expect(results[0]).toBe("applied");
    // The loser saw the event either mid-flight (retry later) or finished.
    expect(["duplicate", "in_progress"]).toContain(results[1]);
    expect(responses.find((response) => response.result === "in_progress")?.status ?? 409).toBe(409);
    expect((await subscriptionRow(user.id))?.status).toBe("active");
    expect(await testDb.raw.stripeEvent.count()).toBe(1);
  });

  it("takes over an event whose first handler died without finishing", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const event = buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" }), { id: "evt_orphan" });
    const longAgo = Math.floor(Date.now() / 1000) - CLAIM_LEASE_SECONDS - 5;
    await testDb.raw.stripeEvent.create({
      data: { claimedAt: longAgo, eventCreated: longAgo, id: "evt_orphan", status: "processing", type: "customer.subscription.created" },
    });

    const response = await deliver(event);

    expect(response).toMatchObject({ result: "applied", status: 200 });
    expect((await subscriptionRow(user.id))?.status).toBe("active");
  });

  it("answers 409 while another delivery of the same event is still being handled", async () => {
    await createCustomerUser();
    const justNow = Math.floor(Date.now() / 1000);
    await testDb.raw.stripeEvent.create({
      data: { claimedAt: justNow, eventCreated: justNow, id: "evt_busy", status: "processing", type: "customer.subscription.created" },
    });

    const response = await deliver(
      buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" }), { id: "evt_busy" }),
    );

    expect(response).toMatchObject({ result: "in_progress", status: 409 });
  });
});

describe("events out of order", () => {
  it("a late subscription.updated after subscription.deleted does not reactivate", async () => {
    const user = await createCustomerUser();
    // Stripe's truth: the subscription has been cancelled.
    stripeHas({
      cancellationReason: "payment_failed",
      customer: "cus_alice",
      endedAt: T0 + 40 * DAY,
      id: "sub_1",
      status: "canceled",
    });

    const deleted = await deliver(
      buildEvent(
        "customer.subscription.deleted",
        buildSubscription({ customer: "cus_alice", endedAt: T0 + 40 * DAY, id: "sub_1", status: "canceled" }),
        { created: T0 + 40 * DAY },
      ),
    );
    // Sent earlier, delivered later: its body still says "active".
    const lateUpdate = await deliver(
      buildEvent(
        "customer.subscription.updated",
        buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" }),
        { created: T0 + 39 * DAY },
      ),
    );

    expect(deleted.status).toBe(200);
    expect(lateUpdate.status).toBe(200);
    const row = await subscriptionRow(user.id);
    expect(row).toMatchObject({ isActive: false, status: "canceled" });
    expect(entitlementsFor(row, new Date()).hasProAccess).toBe(false);
  });

  it("created, updated and invoice.paid in any order end in the state Stripe has", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const sub = buildSubscription({ customer: "cus_alice", id: "sub_1", status: "incomplete" });

    await deliver(buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" })));
    await deliver(buildEvent("customer.subscription.updated", sub));
    await deliver(buildEvent("customer.subscription.created", sub));

    expect((await subscriptionRow(user.id))?.status).toBe("active");
  });

  it("stamps the row with Stripe's clock (the response's Date header), not the local one", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const stripeTime = new Date("2031-02-03T04:05:06Z");
    stub.setNow(() => stripeTime);

    await deliver(buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" })));

    expect((await subscriptionRow(user.id))?.stripeSyncedAt).toEqual(stripeTime);
  });

  it("a slow handler holding an older reading loses to a newer one already stored", async () => {
    const user = await createCustomerUser();
    // Stored: "canceled", read at 12:00:10 on Stripe's clock.
    stripeHas({ cancellationReason: "payment_failed", customer: "cus_alice", id: "sub_1", status: "canceled" });
    stub.setNow(() => new Date("2031-02-03T12:00:10Z"));
    await deliver(buildEvent("customer.subscription.deleted", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "canceled" })));

    // Another delivery's read was answered earlier (12:00:05, still
    // "active") but its write only happens now.
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    stub.setNow(() => new Date("2031-02-03T12:00:05Z"));
    const slow = await deliver(buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" })));

    expect(slow).toMatchObject({ result: "stale", status: 200 });
    expect((await subscriptionRow(user.id))?.status).toBe("canceled");
  });

  it("a reading taken earlier never replaces one taken later", async () => {
    const user = await createCustomerUser();
    // Two readings of the same subscription through the SDK, five seconds apart.
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const older = subscriptionStateFromStripe(
      await stub.client.subscriptions.retrieve("sub_1"),
      new Date("2030-01-01T00:00:05Z"),
    );
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "canceled" });
    const newer = subscriptionStateFromStripe(
      await stub.client.subscriptions.retrieve("sub_1"),
      new Date("2030-01-01T00:00:10Z"),
    );

    // A slow handler that read "active" writes after a fast one that read "canceled".
    expect(await applySubscriptionState(testDb.db, user.id, newer)).toBe("applied");
    expect(await applySubscriptionState(testDb.db, user.id, older)).toBe("stale");

    expect((await subscriptionRow(user.id))?.status).toBe("canceled");
  });

  it("an event for an old, cancelled subscription does not replace the current one", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", created: T0, endedAt: T0 + 30 * DAY, id: "sub_old", status: "canceled" });
    stripeHas({ customer: "cus_alice", created: T0 + 100 * DAY, id: "sub_new", status: "active" });

    await deliver(buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_alice", id: "sub_new", status: "active" })));
    const straggler = await deliver(
      buildEvent("customer.subscription.deleted", buildSubscription({ customer: "cus_alice", id: "sub_old", status: "canceled" })),
    );

    expect(straggler).toMatchObject({ result: "stale", status: 200 });
    expect(await subscriptionRow(user.id)).toMatchObject({ status: "active", subscriptionId: "sub_new" });
  });

  it("a new subscription replaces a finished one", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", created: T0, endedAt: T0 + 30 * DAY, id: "sub_old", status: "canceled" });
    stripeHas({ customer: "cus_alice", created: T0 + 100 * DAY, id: "sub_new", status: "active" });

    await deliver(buildEvent("customer.subscription.deleted", buildSubscription({ customer: "cus_alice", id: "sub_old", status: "canceled" })));
    await deliver(buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_alice", id: "sub_new", status: "active" })));

    expect(await subscriptionRow(user.id)).toMatchObject({ status: "active", subscriptionId: "sub_new" });
  });
});

describe("payment failure and recovery", () => {
  it("keeps access while Stripe retries, and returns to active when the invoice is paid", async () => {
    const user = await createCustomerUser();
    const renewal = Math.floor(Date.now() / 1000) - 2 * DAY; // renewed (and failed) two days ago
    stripeHas({ customer: "cus_alice", id: "sub_1", periodStart: renewal, status: "past_due" });

    const failed = await deliver(
      buildEvent("invoice.payment_failed", buildInvoice({ customer: "cus_alice", id: "in_2", status: "open", subscriptionId: "sub_1" })),
    );

    const pastDue = await subscriptionRow(user.id);
    expect(failed).toMatchObject({ result: "applied", status: 200 });
    expect(pastDue?.status).toBe("past_due");
    expect(entitlementsFor(pastDue, new Date())).toMatchObject({
      hasProAccess: true,
      isPastDue: true,
      reason: "past_due_grace",
    });

    // The retry succeeds.
    stripeHas({ customer: "cus_alice", id: "sub_1", periodStart: renewal, status: "active" });
    await deliver(buildEvent("invoice.payment_succeeded", buildInvoice({ customer: "cus_alice", id: "in_2", status: "paid", subscriptionId: "sub_1" })));
    await deliver(buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_2", status: "paid", subscriptionId: "sub_1" })));

    const recovered = await subscriptionRow(user.id);
    expect(recovered?.status).toBe("active");
    expect(entitlementsFor(recovered, new Date())).toMatchObject({ hasProAccess: true, isPastDue: false });
  });

  it("ends access when Stripe gives up and cancels for non-payment", async () => {
    const user = await createCustomerUser();
    const now = Math.floor(Date.now() / 1000);
    stripeHas({ customer: "cus_alice", id: "sub_1", periodStart: now - 10 * DAY, status: "past_due" });
    await deliver(buildEvent("invoice.payment_failed", buildInvoice({ customer: "cus_alice", id: "in_2", status: "open", subscriptionId: "sub_1" })));

    stripeHas({
      cancellationReason: "payment_failed",
      customer: "cus_alice",
      endedAt: now,
      id: "sub_1",
      // The period that was never paid for still lies in the future.
      periodEnd: now + 20 * DAY,
      periodStart: now - 10 * DAY,
      status: "canceled",
    });
    await deliver(buildEvent("customer.subscription.deleted", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "canceled" })));

    const row = await subscriptionRow(user.id);
    expect(row).toMatchObject({ cancellationReason: "payment_failed", status: "canceled" });
    expect(entitlementsFor(row, new Date()).hasProAccess).toBe(false);
  });

  it("ignores an invoice that does not belong to a subscription", async () => {
    await createCustomerUser();

    const response = await deliver(
      buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_oneoff", status: "paid", subscriptionId: null })),
    );

    expect(response).toMatchObject({ result: "not_a_subscription", status: 200 });
    expect(stub.requests).toHaveLength(0);
  });
});

describe("cancelled while the period is unpaid", () => {
  it("an annual renewal that failed, cancelled at once by the customer, grants nothing", async () => {
    const user = await createCustomerUser();
    const now = Math.floor(Date.now() / 1000);
    const renewal = { interval: "year" as const, latestInvoice: "in_renewal", periodEnd: now + 364 * DAY, periodStart: now - DAY };
    stub.invoices.set("in_renewal", buildInvoice({ created: now - DAY, customer: "cus_alice", id: "in_renewal", status: "open", subscriptionId: "sub_1" }));
    stripeHas({ ...renewal, customer: "cus_alice", id: "sub_1", status: "past_due" });
    await deliver(buildEvent("invoice.payment_failed", buildInvoice({ customer: "cus_alice", id: "in_renewal", status: "open", subscriptionId: "sub_1" })));
    expect(entitlementsFor(await subscriptionRow(user.id), new Date()).reason).toBe("past_due_grace");

    // The customer cancels immediately: `cancellation_requested`, with a
    // year of period left that nobody paid for.
    stripeHas({ ...renewal, cancellationReason: "cancellation_requested", customer: "cus_alice", endedAt: now, id: "sub_1", status: "canceled" });
    await deliver(buildEvent("customer.subscription.deleted", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "canceled" })));

    const row = await subscriptionRow(user.id);
    expect(row).toMatchObject({
      cancellationReason: "cancellation_requested",
      currentPeriodEnd: new Date((now + 364 * DAY) * 1000),
      paidThroughAt: null,
      pastDueSince: null,
      status: "canceled",
    });
    expect(entitlementsFor(row, new Date())).toMatchObject({ hasProAccess: false, reason: "none" });
  });

  it("the same cancellation with the period paid keeps access until it ends", async () => {
    const user = await createCustomerUser();
    const now = Math.floor(Date.now() / 1000);
    stripeHas({ cancellationReason: "cancellation_requested", customer: "cus_alice", endedAt: now, id: "sub_1", periodEnd: now + 200 * DAY, periodStart: now - 165 * DAY, status: "canceled" });

    await deliver(buildEvent("customer.subscription.deleted", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "canceled" })));

    const row = await subscriptionRow(user.id);
    expect(row?.paidThroughAt).toEqual(new Date((now + 200 * DAY) * 1000));
    expect(entitlementsFor(row, new Date())).toMatchObject({ hasProAccess: true, reason: "canceled_paid_period" });
  });
});

describe("disputes and refunds", () => {
  /** An active subscription whose latest invoice in_1 was paid by pi_1 / ch_1. */
  async function paidSubscription(status = "active", extra: Partial<StubSubscriptionInput> = {}) {
    const user = await createCustomerUser();
    const now = Math.floor(Date.now() / 1000);
    stripeHas({ customer: "cus_alice", id: "sub_1", latestInvoice: "in_1", periodEnd: now + 20 * DAY, periodStart: now - 10 * DAY, status, ...extra });
    stub.invoices.set("in_1", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" }));
    stub.invoicePayments.set("inpay_1", buildInvoicePayment({ id: "inpay_1", invoice: "in_1", paymentIntent: "pi_1" }));
    stub.charges.set("ch_1", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" }));
    await deliver(buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_alice", id: "sub_1", status })));
    return user;
  }

  const disputeIs = (status: string, id = "dp_1") => {
    const dispute = buildDispute({ charge: "ch_1", id, paymentIntent: "pi_1", status });
    stub.disputes.set(id, dispute);
    return dispute;
  };

  const access = async (userId: string) => entitlementsFor(await subscriptionRow(userId), new Date());

  it("a dispute suspends access at once, and winning it restores access", async () => {
    const user = await paidSubscription();
    expect((await access(user.id)).hasProAccess).toBe(true);

    const opened = await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response")));

    expect(opened).toMatchObject({ result: "dispute_recorded", status: 200 });
    expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_1", disputeInvoiceId: "in_1", disputeStatus: "open", status: "active" });
    expect(await access(user.id)).toMatchObject({ hasProAccess: false, isDisputed: true });

    const closed = await deliver(buildEvent("charge.dispute.closed", disputeIs("won")));

    expect(closed).toMatchObject({ result: "dispute_recorded", status: 200 });
    expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: null, disputeInvoiceId: null, disputeStatus: null });
    expect(await access(user.id)).toMatchObject({ hasProAccess: true, isDisputed: false });
  });

  it("a lost dispute leaves the period it paid for without access, until a later invoice is paid", async () => {
    const user = await paidSubscription();
    await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response")));

    await deliver(buildEvent("charge.dispute.closed", disputeIs("lost")));

    expect(await subscriptionRow(user.id)).toMatchObject({ disputeInvoiceId: "in_1", disputeStatus: "lost" });
    expect(await access(user.id)).toMatchObject({ hasProAccess: false, isDisputed: true });

    // The renewal is issued but its payment fails: a new latest invoice,
    // unpaid, and the subscription past due. That is not "a later invoice
    // is paid": no grace access on top of a lost payment.
    const renewal = (status: "open" | "paid") =>
      buildInvoice({ created: T0 + 30 * DAY, customer: "cus_alice", id: "in_2", status, subscriptionId: "sub_1" });
    stub.invoices.set("in_2", renewal("open"));
    stripeHas({ customer: "cus_alice", id: "sub_1", latestInvoice: "in_2", status: "past_due" });
    await deliver(buildEvent("invoice.payment_failed", renewal("open")));

    expect(await subscriptionRow(user.id)).toMatchObject({ disputeInvoiceId: "in_1", disputeStatus: "lost", latestInvoiceId: "in_2", status: "past_due" });
    expect(await access(user.id)).toMatchObject({ hasProAccess: false, isDisputed: true, isPastDue: true });

    // The retry succeeds: now a later invoice is paid.
    stub.invoices.set("in_2", renewal("paid"));
    stripeHas({ customer: "cus_alice", id: "sub_1", latestInvoice: "in_2", status: "active" });
    await deliver(buildEvent("invoice.paid", renewal("paid")));

    expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: null, disputeInvoiceId: null, disputeStatus: null });
    expect(await access(user.id)).toMatchObject({ hasProAccess: true, isDisputed: false });
  });

  it("a later invoice that is `paid` without any money (a trial, a credit) does not lift a lost dispute", async () => {
    const user = await paidSubscription();
    await deliver(buildEvent("charge.dispute.closed", disputeIs("lost")));
    expect((await access(user.id)).hasProAccess).toBe(false);

    const free = buildInvoice({ amountPaid: 0, created: T0 + 30 * DAY, customer: "cus_alice", id: "in_2", status: "paid", subscriptionId: "sub_1" });
    stub.invoices.set("in_2", free);
    stripeHas({ customer: "cus_alice", id: "sub_1", latestInvoice: "in_2", status: "active" });
    await deliver(buildEvent("invoice.paid", free));

    expect(await subscriptionRow(user.id)).toMatchObject({ disputeInvoiceId: "in_1", disputeStatus: "lost", latestInvoiceId: "in_2" });
    expect(await access(user.id)).toMatchObject({ hasProAccess: false, isDisputed: true });

    // An invoice that money was paid for does.
    const paidFor = buildInvoice({ created: T0 + 60 * DAY, customer: "cus_alice", id: "in_3", status: "paid", subscriptionId: "sub_1" });
    stub.invoices.set("in_3", paidFor);
    stripeHas({ customer: "cus_alice", id: "sub_1", latestInvoice: "in_3", status: "active" });
    await deliver(buildEvent("invoice.paid", paidFor));

    expect((await access(user.id)).hasProAccess).toBe(true);
  });

  describe("bounds on what one derivation reads", () => {
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    /** `count` more paid invoices of sub_1, each with a charge that was disputed and WON; newest last. */
    function wonDisputes(count: number, createdFrom: number) {
      for (let i = 1; i <= count; i += 1) {
        stub.invoices.set(`in_old_${i}`, buildInvoice({ created: createdFrom + i, customer: "cus_alice", id: `in_old_${i}`, status: "paid", subscriptionId: "sub_1" }));
        stub.invoicePayments.set(`inpay_old_${i}`, buildInvoicePayment({ id: `inpay_old_${i}`, invoice: `in_old_${i}`, paymentIntent: `pi_old_${i}` }));
        stub.charges.set(`ch_old_${i}`, buildCharge({ created: createdFrom + i, customer: "cus_alice", id: `ch_old_${i}`, paymentIntent: `pi_old_${i}` }));
        stub.disputes.set(`dp_old_${i}`, buildDispute({ charge: `ch_old_${i}`, id: `dp_old_${i}`, paymentIntent: `pi_old_${i}`, status: "won" }));
      }
    }

    const disputeLists = () => stub.requests.filter((request) => request.path === "/v1/disputes").length;
    const errorText = () => vi.mocked(console.error).mock.calls.flat().join(" ");

    const stripeCallsDuring = async (work: () => Promise<unknown>) => {
      const before = stub.requests.length;
      await work();
      return stub.requests.length - before;
    };

    it("examines at most five disputed charges, in a bounded number of Stripe requests; with more, access is withheld and it is reported", async () => {
      const user = await paidSubscription();
      wonDisputes(MAX_DISPUTED_CHARGES, nowSeconds() - 100 * DAY);
      const invoice = buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" });

      // Five, all won: nothing is withheld.
      await deliver(buildEvent("invoice.paid", invoice));
      expect(await subscriptionRow(user.id)).toMatchObject({ disputeStatus: null });
      expect((await access(user.id)).hasProAccess).toBe(true);

      // A sixth and a seventh: the two oldest are not looked at, and may be open.
      wonDisputes(7, nowSeconds() - 100 * DAY);
      const disputeListsBefore = disputeLists();
      let withheld: Awaited<ReturnType<typeof deliver>> | undefined;
      const calls = await stripeCallsDuring(async () => {
        withheld = await deliver(buildEvent("invoice.payment_succeeded", invoice));
      });

      expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: null, disputeStatus: "open" });
      expect(await access(user.id)).toMatchObject({ hasProAccess: false, isDisputed: true });
      // Not passed off as handled-and-settled: the outcome says so, and the row is named for review.
      expect(withheld).toMatchObject({ result: "standing_incomplete", status: 200 });
      expect(errorText()).toContain("incomplete history");
      expect(errorText()).toContain((await subscriptionRow(user.id))?.id);
      // The subscription itself, then the standing within its bound: the
      // disputes of five charges were read, not of seven.
      expect(calls).toBeLessThanOrEqual(1 + MAX_STANDING_STRIPE_CALLS);
      expect(disputeLists() - disputeListsBefore).toBe(MAX_DISPUTED_CHARGES);
    });

    it("an open dispute among the newest is recorded as itself, however many older ones there are", async () => {
      const user = await paidSubscription();
      wonDisputes(9, nowSeconds() - 100 * DAY);
      stub.charges.set("ch_1", buildCharge({ created: nowSeconds(), customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" }));

      await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response")));

      expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_1", disputeInvoiceId: "in_1", disputeStatus: "open" });
    });

    it("leaves disputed charges of more than two years ago out of it", async () => {
      const user = await paidSubscription();
      wonDisputes(9, nowSeconds() - 3 * 365 * DAY);

      await deliver(buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" })));

      expect(await subscriptionRow(user.id)).toMatchObject({ disputeStatus: null });
      expect((await access(user.id)).hasProAccess).toBe(true);
      expect(stub.requests.filter((request) => request.path === "/v1/disputes")).toHaveLength(0);
    });

    describe("a customer with more charges than are listed (an incomplete charge history)", () => {
      /** 320 charges of the last year and a bit; the listing reads the newest 300. */
      function longHistory() {
        for (let i = 1; i <= 320; i += 1) {
          stub.charges.set(`ch_bulk_${i}`, buildCharge({ created: nowSeconds() - 400 * DAY + i, customer: "cus_alice", id: `ch_bulk_${i}`, paymentIntent: `pi_bulk_${i}` }));
        }
      }
      const chargeLists = () => stub.requests.filter((request) => request.path === "/v1/charges" && request.params.customer !== undefined).length;

      it("a NEW dispute is recorded, not left out because the previous standing was kept: on a recent charge", async () => {
        const user = await paidSubscription();
        longHistory();
        stub.charges.set("ch_1", buildCharge({ created: nowSeconds(), customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" }));
        expect(await subscriptionRow(user.id)).toMatchObject({ disputeStatus: null, status: "active" });

        const opened = await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response")));

        expect(opened).toMatchObject({ result: "dispute_recorded", status: 200 });
        expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_1", disputeStatus: "open" });
        expect(await access(user.id)).toMatchObject({ hasProAccess: false, isDisputed: true });
        expect(chargeLists()).toBe(3);
      });

      it("and on a charge OLDER than everything listed: the event's own charge is read directly", async () => {
        const user = await paidSubscription();
        longHistory();
        // ch_1 paid in_1 five hundred days ago: behind all 320 newer charges.
        stub.charges.set("ch_1", buildCharge({ created: nowSeconds() - 500 * DAY, customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" }));

        const opened = await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response")));

        expect(opened).toMatchObject({ result: "dispute_recorded", status: 200 });
        expect(stub.requests.some((request) => request.path === "/v1/charges" && request.params.payment_intent === "pi_1")).toBe(true);
        expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_1", disputeInvoiceId: "in_1", disputeStatus: "open" });
        expect((await access(user.id)).hasProAccess).toBe(false);
      });

      it("a WON dispute clears, and the paying customer is not left blocked; what could not be read is reported with the row's id", async () => {
        const user = await paidSubscription();
        longHistory();
        stub.charges.set("ch_1", buildCharge({ created: nowSeconds() - 500 * DAY, customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" }));
        await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response")));
        expect((await access(user.id)).hasProAccess).toBe(false);

        const closed = await deliver(buildEvent("charge.dispute.closed", disputeIs("won")));

        expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: null, disputeInvoiceId: null, disputeStatus: null });
        expect(await access(user.id)).toMatchObject({ hasProAccess: true, isDisputed: false });
        // Twenty charges of the last two years were not read: said, not hidden.
        expect(closed).toMatchObject({ result: "standing_incomplete", status: 200 });
        expect(errorText()).toContain("incomplete history");
        expect(errorText()).toContain((await subscriptionRow(user.id))?.id);
      });

      describe("a dispute recorded on a charge the listing does not reach is not cleared by a later derivation that cannot see it", () => {
        /** Dispute A, open, on ch_1: five hundred days old, behind 320 newer charges. Recorded by its own event. */
        async function disputeOnUnlistedCharge() {
          const user = await paidSubscription();
          longHistory();
          stub.charges.set("ch_1", buildCharge({ created: nowSeconds() - 500 * DAY, customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" }));
          await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response")));
          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_1", disputeStatus: "open" });
          return user;
        }

        it("an invoice event (which names no payment intent of the dispute) leaves it open", async () => {
          const user = await disputeOnUnlistedCharge();

          const paid = await deliver(buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" })));

          expect(paid.status).toBe(200);
          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_1", disputeInvoiceId: "in_1", disputeStatus: "open" });
          expect(await access(user.id)).toMatchObject({ hasProAccess: false, isDisputed: true });
          expect(stub.requests.some((request) => request.path === "/v1/disputes/dp_1")).toBe(true);
        });

        it("a dispute closing on ANOTHER charge leaves it open", async () => {
          const user = await disputeOnUnlistedCharge();
          // A second, recent payment of the subscription, disputed and won.
          stub.invoices.set("in_b", buildInvoice({ created: T0 - DAY, customer: "cus_alice", id: "in_b", status: "paid", subscriptionId: "sub_1" }));
          stub.invoicePayments.set("inpay_b", buildInvoicePayment({ id: "inpay_b", invoice: "in_b", paymentIntent: "pi_b" }));
          stub.charges.set("ch_b", buildCharge({ created: nowSeconds(), customer: "cus_alice", id: "ch_b", paymentIntent: "pi_b" }));
          const won = buildDispute({ charge: "ch_b", id: "dp_b", paymentIntent: "pi_b", status: "won" });
          stub.disputes.set("dp_b", won);

          await deliver(buildEvent("charge.dispute.closed", won));

          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_1", disputeStatus: "open" });
          expect((await access(user.id)).hasProAccess).toBe(false);
        });

        it("it clears when the stored dispute itself reads as won, whichever event brings the derivation", async () => {
          const user = await disputeOnUnlistedCharge();
          disputeIs("won");

          await deliver(buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" })));

          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: null, disputeStatus: null });
          expect((await access(user.id)).hasProAccess).toBe(true);
        });

        it("a stored LOST dispute on an unlisted charge keeps withholding until a later invoice is paid for", async () => {
          const user = await disputeOnUnlistedCharge();
          await deliver(buildEvent("charge.dispute.closed", disputeIs("lost")));
          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_1", disputeStatus: "lost" });

          // An event that knows nothing of ch_1: still lost.
          await deliver(buildEvent("invoice.payment_succeeded", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" })));
          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_1", disputeStatus: "lost" });
          expect((await access(user.id)).hasProAccess).toBe(false);

          // A later invoice is paid for: superseded.
          const next = buildInvoice({ created: T0 + 30 * DAY, customer: "cus_alice", id: "in_2", status: "paid", subscriptionId: "sub_1" });
          stub.invoices.set("in_2", next);
          stripeHas({ customer: "cus_alice", id: "sub_1", latestInvoice: "in_2", status: "active" });
          await deliver(buildEvent("invoice.paid", next));
          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: null, disputeStatus: null });
          expect((await access(user.id)).hasProAccess).toBe(true);
        });

        it("a stored full refund of the latest invoice, paid by an unlisted charge, is not cleared either", async () => {
          const user = await paidSubscription("canceled", { cancellationReason: "cancellation_requested" });
          longHistory();
          stub.charges.set("ch_1", buildCharge({ created: nowSeconds() - 500 * DAY, customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1", refunded: true }));
          await deliver(buildEvent("charge.refunded", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1", refunded: true })));
          expect((await subscriptionRow(user.id))?.refundedInvoiceId).toBe("in_1");

          await deliver(buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" })));

          expect((await subscriptionRow(user.id))?.refundedInvoiceId).toBe("in_1");
          expect(await access(user.id)).toMatchObject({ hasProAccess: false, reason: "none" });
        });
      });

      describe("every dispute ever learned of is remembered until Stripe says it is over", () => {
        /** Another old payment of sub_1 (invoice in_<name>, charge ch_<name>), outside the listing. */
        function oldPayment(name: string, daysAgo: number) {
          stub.invoices.set(`in_${name}`, buildInvoice({ created: T0 - daysAgo * DAY, customer: "cus_alice", id: `in_${name}`, status: "paid", subscriptionId: "sub_1" }));
          stub.invoicePayments.set(`inpay_${name}`, buildInvoicePayment({ id: `inpay_${name}`, invoice: `in_${name}`, paymentIntent: `pi_${name}` }));
          stub.charges.set(`ch_${name}`, buildCharge({ created: nowSeconds() - daysAgo * DAY, customer: "cus_alice", id: `ch_${name}`, paymentIntent: `pi_${name}` }));
        }
        const dispute = (name: string, status: string) => {
          const object = buildDispute({ charge: `ch_${name}`, id: `dp_${name}`, paymentIntent: `pi_${name}`, status });
          stub.disputes.set(`dp_${name}`, object);
          return object;
        };
        const known = async () =>
          Object.fromEntries((await testDb.db.subscriptionDispute.findMany()).map((row) => [row.disputeId, row.status]));

        /** A and B, both on charges outside the newest 300, both opened, both creation events delivered. */
        async function twoUnlistedOpenDisputes() {
          const user = await paidSubscription();
          longHistory();
          oldPayment("a", 500);
          oldPayment("b", 470);
          await deliver(buildEvent("charge.dispute.created", dispute("a", "needs_response")));
          await deliver(buildEvent("charge.dispute.created", dispute("b", "needs_response")));
          expect(await known()).toEqual({ dp_a: "open", dp_b: "open" });
          expect((await access(user.id)).hasProAccess).toBe(false);
          return user;
        }

        it("open A, open B, win B while A stays open: access is still withheld", async () => {
          const user = await twoUnlistedOpenDisputes();

          await deliver(buildEvent("charge.dispute.closed", dispute("b", "won")));

          expect(await known()).toEqual({ dp_a: "open", dp_b: "cleared" });
          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_a", disputeInvoiceId: "in_a", disputeStatus: "open" });
          expect(await access(user.id)).toMatchObject({ hasProAccess: false, isDisputed: true });

          // And it stays withheld through events that know of neither.
          await deliver(buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" })));
          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_a", disputeStatus: "open" });
        });

        it("the other way round, win A while B stays open: still withheld; both resolved: access is back", async () => {
          const user = await twoUnlistedOpenDisputes();

          await deliver(buildEvent("charge.dispute.closed", dispute("a", "won")));
          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_b", disputeStatus: "open" });
          expect((await access(user.id)).hasProAccess).toBe(false);

          await deliver(buildEvent("charge.dispute.closed", dispute("b", "won")));
          expect(await known()).toEqual({ dp_a: "cleared", dp_b: "cleared" });
          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: null, disputeStatus: null });
          expect(await access(user.id)).toMatchObject({ hasProAccess: true, isDisputed: false });
        });

        it("a dispute won without its closing event ever arriving is still found won, by id, at the next derivation", async () => {
          const user = await twoUnlistedOpenDisputes();
          dispute("a", "won");
          dispute("b", "won");

          await deliver(buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" })));

          expect(await known()).toEqual({ dp_a: "cleared", dp_b: "cleared" });
          expect((await access(user.id)).hasProAccess).toBe(true);
        });

        it("lost A superseded by a later paid invoice while B is open: still withheld, and released when B is won", async () => {
          const user = await twoUnlistedOpenDisputes();

          // A is lost. in_1 (the latest invoice) was paid for after in_a, so the loss is superseded at once...
          await deliver(buildEvent("charge.dispute.closed", dispute("a", "lost")));
          expect(await known()).toEqual({ dp_a: "superseded", dp_b: "open" });
          // ...but B is open.
          expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_b", disputeStatus: "open" });
          expect((await access(user.id)).hasProAccess).toBe(false);

          await deliver(buildEvent("charge.dispute.closed", dispute("b", "won")));
          expect(await known()).toEqual({ dp_a: "superseded", dp_b: "cleared" });
          expect((await access(user.id)).hasProAccess).toBe(true);
        });

        it("an inquiry is remembered without withholding, and withholds once it has become a chargeback, event or no event", async () => {
          const user = await paidSubscription();
          longHistory();
          oldPayment("a", 500);
          await deliver(buildEvent("charge.dispute.created", dispute("a", "warning_needs_response")));
          expect(await known()).toEqual({ dp_a: "inquiry" });
          expect((await access(user.id)).hasProAccess).toBe(true);

          // It escalates; the update event is lost. An unrelated event's derivation re-reads it.
          dispute("a", "needs_response");
          await deliver(buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" })));

          expect(await known()).toEqual({ dp_a: "open" });
          expect((await access(user.id)).hasProAccess).toBe(false);
        });

        it("more known open disputes than are re-read fails closed and is reported; the rest are read the next time", async () => {
          const user = await paidSubscription();
          // Eleven disputes the app once recorded as open; at Stripe all of them have since been won.
          for (let i = 1; i <= MAX_KNOWN_DISPUTES_REREAD + 1; i += 1) {
            const id = String(i).padStart(2, "0");
            stub.disputes.set(`dp_k${id}`, buildDispute({ charge: `ch_k${id}`, id: `dp_k${id}`, paymentIntent: `pi_k${id}`, status: "won" }));
            await testDb.db.subscriptionDispute.create({
              data: { disputeId: `dp_k${id}`, invoiceId: `in_k${id}`, status: "open", subscriptionId: "sub_1", updatedAt: new Date(T0 * 1000 + i) },
            });
          }
          const invoice = buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" });
          const retrievals = () => stub.requests.filter((request) => request.path.startsWith("/v1/disputes/dp_k")).length;

          const first = await deliver(buildEvent("invoice.paid", invoice));

          // Ten were re-read (and are over); one was not, and so still counts as open.
          expect(retrievals()).toBe(MAX_KNOWN_DISPUTES_REREAD);
          expect(Object.values(await known()).filter((status) => status === "open")).toHaveLength(1);
          expect(first).toMatchObject({ result: "standing_incomplete", status: 200 });
          expect((await subscriptionRow(user.id))?.disputeStatus).toBe("open");
          expect((await access(user.id)).hasProAccess).toBe(false);
          expect(errorText()).toContain((await subscriptionRow(user.id))?.id);

          // The next derivation reads the one that was left.
          await deliver(buildEvent("invoice.payment_succeeded", invoice));
          expect(Object.values(await known()).every((status) => status === "cleared")).toBe(true);
          expect((await access(user.id)).hasProAccess).toBe(true);
        });
      });

      it("is not called incomplete when the unread charges are older than any dispute can be", async () => {
        const user = await paidSubscription();
        for (let i = 1; i <= 320; i += 1) {
          stub.charges.set(`ch_old_${i}`, buildCharge({ created: nowSeconds() - 3 * 365 * DAY + i, customer: "cus_alice", id: `ch_old_${i}`, paymentIntent: `pi_old_${i}` }));
        }

        const paid = await deliver(buildEvent("invoice.paid", buildInvoice({ customer: "cus_alice", id: "in_1", status: "paid", subscriptionId: "sub_1" })));

        expect(paid.result).not.toBe("standing_incomplete");
        expect(paid.status).toBe(200);
        expect((await access(user.id)).hasProAccess).toBe(true);
      });
    });
  });

  it("winning one dispute does not hide another that is still open, in either order of arrival", async () => {
    const user = await paidSubscription();
    await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response", "dp_a")));
    await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response", "dp_b")));

    // B, the one recorded last, is won. A is still open.
    const wonB = await deliver(buildEvent("charge.dispute.closed", disputeIs("won", "dp_b")));

    expect(wonB).toMatchObject({ result: "dispute_recorded", status: 200 });
    expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_a", disputeStatus: "open" });
    expect(await access(user.id)).toMatchObject({ hasProAccess: false, isDisputed: true });

    await deliver(buildEvent("charge.dispute.closed", disputeIs("won", "dp_a")));

    expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: null, disputeStatus: null });
    expect((await access(user.id)).hasProAccess).toBe(true);
  });

  it("two dispute events handled at once are stored in the order they were read: an older reading cannot overwrite a newer one", async () => {
    const user = await paidSubscription();
    disputeIs("needs_response");
    const created = buildEvent("charge.dispute.created", buildDispute({ charge: "ch_1", id: "dp_1", paymentIntent: "pi_1", status: "needs_response" }));
    const closed = buildEvent("charge.dispute.closed", buildDispute({ charge: "ch_1", id: "dp_1", paymentIntent: "pi_1", status: "won" }));

    // While the first handler is reading the standing ("open"), the dispute
    // is won and the second event is delivered. The first handler is held
    // long enough for the second to overtake it, if anything let it.
    const overtaker: { delivery: ReturnType<typeof deliver> | null } = { delivery: null };
    stub.onRequest(async (request) => {
      if (overtaker.delivery || request.path !== "/v1/disputes") return;
      disputeIs("won");
      overtaker.delivery = deliver(closed);
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    const first = await deliver(created);
    const overtaking = await overtaker.delivery;

    expect(first).toMatchObject({ result: "dispute_recorded", status: 200 });
    expect(overtaking).toMatchObject({ result: "dispute_recorded", status: 200 });
    expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: null, disputeStatus: null });
    expect((await access(user.id)).hasProAccess).toBe(true);
  });

  it("answers 409 while the customer's lease is held elsewhere, and handles the redelivery", async () => {
    const user = await paidSubscription();
    const event = buildEvent("charge.dispute.created", disputeIs("needs_response"));
    const farFuture = Math.floor(Date.now() / 1000) + 3600;
    await testDb.raw.$executeRaw`
      INSERT INTO "BillingLease" ("key", "holder", "expiresAt") VALUES ('customer:cus_alice', 'someone-else', ${farFuture})`;
    // Each look at the clock is five seconds on: the wait is over at once.
    let clock = Date.now();
    deps = { ...deps, sync: { lease: { now: () => (clock += 5000), sleep: () => Promise.resolve() } } };

    const busy = await deliver(event);

    expect(busy).toMatchObject({ result: "busy", status: 409 });
    expect((await subscriptionRow(user.id))?.disputeStatus).toBeNull();

    await testDb.raw.$executeRaw`DELETE FROM "BillingLease" WHERE "key" = 'customer:cus_alice'`;
    expect(await deliver(event)).toMatchObject({ result: "dispute_recorded", status: 200 });
    expect((await subscriptionRow(user.id))?.disputeStatus).toBe("open");
  });

  it("reads the dispute from Stripe, so `created` delivered after `closed` does not suspend again", async () => {
    const user = await paidSubscription();
    disputeIs("won");

    // The bodies say what was true when each event was made; Stripe says "won".
    await deliver(buildEvent("charge.dispute.closed", buildDispute({ charge: "ch_1", id: "dp_1", paymentIntent: "pi_1", status: "won" })));
    const late = await deliver(buildEvent("charge.dispute.created", buildDispute({ charge: "ch_1", id: "dp_1", paymentIntent: "pi_1", status: "needs_response" })));

    expect(late.status).toBe(200);
    expect((await subscriptionRow(user.id))?.disputeStatus).toBeNull();
    expect((await access(user.id)).hasProAccess).toBe(true);
  });

  it("is idempotent, and an escalating inquiry suspends only once it becomes a chargeback", async () => {
    const user = await paidSubscription();

    await deliver(buildEvent("charge.dispute.created", disputeIs("warning_needs_response")));
    expect((await access(user.id)).hasProAccess).toBe(true);

    const escalated = buildEvent("charge.dispute.updated", disputeIs("needs_response"));
    await deliver(escalated);
    const redelivered = await deliver(escalated);
    const again = await deliver(buildEvent("charge.dispute.updated", disputeIs("under_review")));

    expect(redelivered).toMatchObject({ result: "duplicate", status: 200 });
    expect(again).toMatchObject({ result: "dispute_recorded", status: 200 });
    expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_1", disputeStatus: "open" });
  });

  it("closing one dispute does not lift the suspension of another that is still open", async () => {
    const user = await paidSubscription();
    await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response", "dp_1")));
    await deliver(buildEvent("charge.dispute.created", disputeIs("needs_response", "dp_2")));

    await deliver(buildEvent("charge.dispute.closed", disputeIs("won", "dp_1")));
    const lostOther = await deliver(buildEvent("charge.dispute.closed", disputeIs("lost", "dp_1")));

    expect(lostOther.status).toBe(200);
    expect(await subscriptionRow(user.id)).toMatchObject({ disputeId: "dp_2", disputeStatus: "open" });
    expect((await access(user.id)).hasProAccess).toBe(false);
  });

  it("a full refund ends the paid remainder of a cancelled subscription; a partial one does not", async () => {
    const user = await paidSubscription("canceled", { cancellationReason: "cancellation_requested" });
    expect((await access(user.id)).reason).toBe("canceled_paid_period");

    stub.charges.set("ch_1", buildCharge({ amountRefunded: 500, customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" }));
    const partial = await deliver(buildEvent("charge.refunded", buildCharge({ amountRefunded: 500, customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" })));
    expect(partial).toMatchObject({ result: "refund_recorded", status: 200 });
    expect((await subscriptionRow(user.id))?.refundedInvoiceId).toBeNull();
    expect((await access(user.id)).hasProAccess).toBe(true);

    stub.charges.set("ch_1", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1", refunded: true }));
    const event = buildEvent("charge.refunded", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1", refunded: true }));
    const full = await deliver(event);
    const redelivered = await deliver(event);

    expect(full).toMatchObject({ result: "refund_recorded", status: 200 });
    expect(redelivered).toMatchObject({ result: "duplicate", status: 200 });
    expect((await subscriptionRow(user.id))?.refundedInvoiceId).toBe("in_1");
    expect(await access(user.id)).toMatchObject({ hasProAccess: false, reason: "none" });
  });

  it("a refund that is reversed (the charge is no longer fully refunded) gives the period back", async () => {
    const user = await paidSubscription("canceled", { cancellationReason: "cancellation_requested" });
    stub.charges.set("ch_1", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1", refunded: true }));
    await deliver(buildEvent("charge.refunded", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1", refunded: true })));
    expect((await access(user.id)).hasProAccess).toBe(false);

    stub.charges.set("ch_1", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" }));
    await deliver(buildEvent("charge.refunded", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" })));

    expect((await access(user.id)).reason).toBe("canceled_paid_period");
  });

  it.each(["refund.failed", "refund.updated", "charge.refund.updated"])(
    "a full refund that then fails gives the paid period back (%s)",
    async (eventType) => {
      const user = await paidSubscription("canceled", { cancellationReason: "cancellation_requested" });
      stub.charges.set("ch_1", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1", refunded: true }));
      await deliver(buildEvent("charge.refunded", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1", refunded: true })));
      expect((await subscriptionRow(user.id))?.refundedInvoiceId).toBe("in_1");
      expect((await access(user.id)).hasProAccess).toBe(false);

      // The refund bounces: Stripe puts the amount back on the charge and
      // says so with a Refund object, not a Charge.
      stub.charges.set("ch_1", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1" }));
      const failed = await deliver(
        buildEvent(eventType, buildRefund({ charge: "ch_1", id: "re_1", paymentIntent: "pi_1", status: "failed" })),
      );

      expect(failed).toMatchObject({ result: "refund_recorded", status: 200 });
      expect((await subscriptionRow(user.id))?.refundedInvoiceId).toBeNull();
      expect((await access(user.id)).reason).toBe("canceled_paid_period");
    },
  );

  it("a delayed refund event for an older invoice does not undo the refund of the current one", async () => {
    const user = await paidSubscription("canceled", { cancellationReason: "cancellation_requested", latestInvoice: "in_2" });
    stub.invoices.set("in_2", buildInvoice({ created: T0 + 30 * DAY, customer: "cus_alice", id: "in_2", status: "paid", subscriptionId: "sub_1" }));
    stub.invoicePayments.set("inpay_2", buildInvoicePayment({ id: "inpay_2", invoice: "in_2", paymentIntent: "pi_2" }));
    const refunded = (id: string, paymentIntent: string) =>
      buildCharge({ customer: "cus_alice", id, paymentIntent, refunded: true });
    stub.charges.set("ch_1", refunded("ch_1", "pi_1"));
    stub.charges.set("ch_2", refunded("ch_2", "pi_2"));

    await deliver(buildEvent("charge.refunded", refunded("ch_2", "pi_2")));
    expect((await subscriptionRow(user.id))?.refundedInvoiceId).toBe("in_2");

    // The event for last period's refund arrives only now.
    const late = await deliver(buildEvent("charge.refunded", refunded("ch_1", "pi_1")));

    expect(late).toMatchObject({ result: "refund_recorded", status: 200 });
    expect(await subscriptionRow(user.id)).toMatchObject({ latestInvoiceId: "in_2", refundedInvoiceId: "in_2" });
    expect(await access(user.id)).toMatchObject({ hasProAccess: false, reason: "none" });
  });

  it("a refund while the subscription stays active does not remove access (the merchant kept it running)", async () => {
    const user = await paidSubscription();
    stub.charges.set("ch_1", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1", refunded: true }));

    await deliver(buildEvent("charge.refunded", buildCharge({ customer: "cus_alice", id: "ch_1", paymentIntent: "pi_1", refunded: true })));

    expect((await subscriptionRow(user.id))?.refundedInvoiceId).toBe("in_1");
    expect((await access(user.id)).hasProAccess).toBe(true);
  });

  it("ignores disputes and refunds on payments that are not for a subscription invoice", async () => {
    const user = await paidSubscription();
    stub.charges.set("ch_oneoff", buildCharge({ customer: "cus_alice", id: "ch_oneoff", paymentIntent: "pi_oneoff", refunded: true }));
    stub.disputes.set("dp_oneoff", buildDispute({ charge: "ch_oneoff", id: "dp_oneoff", paymentIntent: "pi_oneoff", status: "needs_response" }));
    stub.charges.set("ch_legacy", buildCharge({ customer: "cus_alice", id: "ch_legacy", paymentIntent: null, refunded: true }));

    const refund = await deliver(buildEvent("charge.refunded", buildCharge({ customer: "cus_alice", id: "ch_oneoff", paymentIntent: "pi_oneoff", refunded: true })));
    const dispute = await deliver(buildEvent("charge.dispute.created", buildDispute({ charge: "ch_oneoff", id: "dp_oneoff", paymentIntent: "pi_oneoff", status: "needs_response" })));
    const legacy = await deliver(buildEvent("charge.refunded", buildCharge({ customer: "cus_alice", id: "ch_legacy", paymentIntent: null, refunded: true })));
    const gone = await deliver(buildEvent("charge.dispute.created", buildDispute({ charge: "ch_x", id: "dp_gone", paymentIntent: "pi_x", status: "needs_response" })));

    expect([refund.result, dispute.result, legacy.result, gone.result]).toEqual(["not_a_subscription", "not_a_subscription", "not_a_subscription", "not_a_subscription"]);
    expect(await subscriptionRow(user.id)).toMatchObject({ disputeStatus: null, refundedInvoiceId: null });
  });

  it("acknowledges a dispute for a customer that is not a user, and retries when Stripe is down", async () => {
    stub.customers.set("cus_stranger", { id: "cus_stranger", metadata: {}, object: "customer" });
    stripeHas({ customer: "cus_stranger", id: "sub_x", latestInvoice: "in_x", status: "active" });
    stub.invoices.set("in_x", buildInvoice({ customer: "cus_stranger", id: "in_x", status: "paid", subscriptionId: "sub_x" }));
    stub.invoicePayments.set("inpay_x", buildInvoicePayment({ id: "inpay_x", invoice: "in_x", paymentIntent: "pi_x" }));
    const dispute = buildDispute({ charge: "ch_x", id: "dp_x", paymentIntent: "pi_x", status: "needs_response" });
    stub.disputes.set("dp_x", dispute);
    const event = buildEvent("charge.dispute.created", dispute);

    stub.failNext(1);
    expect((await deliver(event)).status).toBe(500);
    expect(await deliver(event)).toMatchObject({ result: "unknown_customer", status: 200 });
    expect(await testDb.raw.subscription.count()).toBe(0);
  });
});

describe("cancel at period end, then expiry", () => {
  it("keeps access until the period ends, then removes it", async () => {
    const user = await createCustomerUser();
    const now = Math.floor(Date.now() / 1000);
    const periodEnd = now + 12 * DAY;
    stripeHas({ cancelAtPeriodEnd: true, customer: "cus_alice", id: "sub_1", periodEnd, periodStart: now - 18 * DAY, status: "active" });

    await deliver(buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" })));

    const scheduled = await subscriptionRow(user.id);
    expect(scheduled).toMatchObject({
      cancelAt: new Date(periodEnd * 1000),
      cancelAtPeriodEnd: true,
      status: "active",
    });
    expect(entitlementsFor(scheduled, new Date())).toMatchObject({
      accessEndsAt: new Date(periodEnd * 1000),
      hasProAccess: true,
    });

    // The period ends: Stripe cancels the subscription and says so.
    stripeHas({
      cancellationReason: "cancellation_requested",
      customer: "cus_alice",
      endedAt: periodEnd,
      id: "sub_1",
      periodEnd,
      periodStart: now - 18 * DAY,
      status: "canceled",
    });
    await deliver(buildEvent("customer.subscription.deleted", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "canceled" })));

    const ended = await subscriptionRow(user.id);
    expect(ended).toMatchObject({ cancelAtPeriodEnd: false, status: "canceled" });
    expect(entitlementsFor(ended, new Date((periodEnd + 1) * 1000)).hasProAccess).toBe(false);
  });

  it("treats an explicit cancel_at date like cancel_at_period_end", async () => {
    const user = await createCustomerUser();
    const cancelAt = Math.floor(Date.now() / 1000) + 5 * DAY;
    stripeHas({ cancelAt, customer: "cus_alice", id: "sub_1", status: "active" });

    await deliver(buildEvent("customer.subscription.updated", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" })));

    expect(await subscriptionRow(user.id)).toMatchObject({
      cancelAt: new Date(cancelAt * 1000),
      cancelAtPeriodEnd: true,
    });
  });
});

describe("transient failures", () => {
  it("answers 500 when Stripe cannot be reached, and the retry is processed", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const event = buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" }));

    stub.failNext(1, 503);
    const failed = await deliver(event);
    const retried = await deliver(event);

    expect(failed.status).toBe(500);
    expect(retried).toMatchObject({ result: "applied", status: 200 });
    expect((await subscriptionRow(user.id))?.status).toBe("active");
  });
});

describe("customer.deleted", () => {
  it("forgets the customer and ends the subscription; a redelivery changes nothing", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    await deliver(buildEvent("customer.subscription.created", buildSubscription({ customer: "cus_alice", id: "sub_1", status: "active" })));

    const response = await deliver(buildEvent("customer.deleted", { id: "cus_alice", object: "customer" }));
    await deliver(buildEvent("customer.deleted", { id: "cus_alice", object: "customer" }));

    expect(response).toMatchObject({ result: "customer_forgotten", status: 200 });
    expect((await testDb.db.user.findUniqueOrThrow({ where: { id: user.id } })).stripeId).toBeNull();
    const row = await subscriptionRow(user.id);
    expect(row?.status).toBe("canceled");
    expect(entitlementsFor(row, new Date()).hasProAccess).toBe(false);
  });
});

describe("other events", () => {
  it("acknowledges event types it has no use for without recording them", async () => {
    const response = await deliver(buildEvent("payment_intent.succeeded", { id: "pi_1", object: "payment_intent" }));

    expect(response).toMatchObject({ result: "ignored", status: 200 });
    expect(await testDb.raw.stripeEvent.count()).toBe(0);
  });

  it("never matches a customer to a user by email (customer.created/updated are ignored)", async () => {
    const user = await createTestUser(testDb.db, { email: "victim@example.com" });

    const response = await deliver(
      buildEvent("customer.updated", { email: "victim@example.com", id: "cus_attacker", object: "customer" }),
    );

    expect(response).toMatchObject({ result: "ignored", status: 200 });
    expect((await testDb.db.user.findUniqueOrThrow({ where: { id: user.id } })).stripeId).toBeNull();
  });
});
