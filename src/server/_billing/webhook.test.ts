import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";
import {
  buildEvent,
  buildInvoice,
  buildSubscription,
  signEvent,
  startStripeStub,
  type StripeStub,
  type StubSubscriptionInput,
} from "~/test/helpers/stripeStub";

import { entitlementsFor } from "./entitlements";
import { CLAIM_LEASE_SECONDS } from "./eventLog";
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
  stub.customers.clear();
  stub.subscriptions.clear();
  stub.requests.length = 0;
  stub.setNow(() => new Date());
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
