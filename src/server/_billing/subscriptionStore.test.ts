import type Stripe from "stripe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";
import {
  buildInvoice,
  buildSubscription,
  startStripeStub,
  type StripeStub,
  type StubSubscriptionInput,
} from "~/test/helpers/stripeStub";

import { entitlementsFor, PAST_DUE_GRACE_DAYS } from "./entitlements";
import {
  disputeStanding,
  pastDueAnchor,
  pickPrimarySubscription,
  subscriptionPrecedence,
  subscriptionStateFromStripe,
} from "./subscriptionState";
import {
  applySubscriptionState,
  syncSubscriptionById,
  syncUserFromStripe,
  UnorderedReadingsError,
} from "./subscriptionStore";

const DAY = 24 * 60 * 60;
const T0 = 1_800_000_000;
const at = (seconds: number) => new Date(seconds * 1000);
const PRICES = {
  STRIPE_FOUNDING_ANNUAL_PRICE_ID: "price_founding_annual",
  STRIPE_FOUNDING_MONTHLY_PRICE_ID: "price_founding_monthly",
  STRIPE_STANDARD_ANNUAL_PRICE_ID: "price_standard_annual",
  STRIPE_STANDARD_MONTHLY_PRICE_ID: "price_standard_monthly",
};

let testDb: TestDb;
let stub: StripeStub;
let errors: MockInstance<(...args: unknown[]) => void>;

beforeAll(async () => {
  stub = await startStripeStub();
});

afterAll(async () => {
  await stub.close();
});

beforeEach(async () => {
  for (const method of ["info", "log", "warn"] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined);
  }
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  testDb = await createTestDb();
  stub.reset();
});

afterEach(async () => {
  await testDb.close();
});

async function createCustomerUser(customerId = "cus_alice") {
  const user = await createTestUser(testDb.db);
  await testDb.db.user.update({ data: { stripeId: customerId }, where: { id: user.id } });
  stub.customers.set(customerId, { id: customerId, metadata: { userId: user.id }, object: "customer" });
  return user;
}

function stripeHas(input: StubSubscriptionInput) {
  stub.subscriptions.set(input.id, buildSubscription(input));
}

/** Makes Stripe's clock (the `Date` header) read `seconds`. */
const stripeClock = (seconds: number) => stub.setNow(() => at(seconds));

const row = (userId: string) => testDb.db.subscription.findUniqueOrThrow({ where: { userId } });

/** A subscription as the SDK parses it, with `latest_invoice` expanded. */
const read = (id: string): Promise<Stripe.Subscription> =>
  stub.client.subscriptions.retrieve(id, { expand: ["latest_invoice"] });

/** No real waiting in tests; records how long the code asked to wait. */
function instantSleep() {
  const waits: number[] = [];
  return { sleep: async (ms: number) => void waits.push(ms), waits };
}

describe("subscriptionStateFromStripe", () => {
  it("takes the period from the plan item and marks it paid when the latest invoice is", async () => {
    stripeHas({ customer: "cus_1", id: "sub_1", interval: "year", periodEnd: T0 + 365 * DAY, periodStart: T0, priceId: "price_founding_annual", status: "active" });

    const state = subscriptionStateFromStripe(await read("sub_1"), at(T0 + 5), PRICES);

    expect(state).toMatchObject({
      currentPeriodEnd: at(T0 + 365 * DAY),
      currentPeriodStart: at(T0),
      interval: "year",
      latestInvoiceId: "in_sub_1",
      paidThroughAt: at(T0 + 365 * DAY),
      plan: "founding",
      priceId: "price_founding_annual",
      status: "active",
    });
  });

  it.each(["open", "uncollectible", "void", "draft"] as const)(
    "does not count the period as paid when the latest invoice is %s",
    async (status) => {
      stripeHas({ customer: "cus_1", id: "sub_1", status: "active" });
      stub.invoices.set("in_sub_1", buildInvoice({ customer: "cus_1", id: "in_sub_1", status, subscriptionId: "sub_1" }));

      expect(subscriptionStateFromStripe(await read("sub_1"), at(T0), PRICES).paidThroughAt).toBeNull();
    },
  );

  it("does not count the period as paid when the invoice was not expanded", async () => {
    stripeHas({ customer: "cus_1", id: "sub_1", status: "active" });

    const state = subscriptionStateFromStripe(await stub.client.subscriptions.retrieve("sub_1"), at(T0), PRICES);

    expect(state).toMatchObject({ latestInvoiceId: "in_sub_1", paidThroughAt: null });
  });

  it("handles a subscription with no items: no plan, no period, nothing paid", async () => {
    const subscription = await read((stripeHas({ customer: "cus_1", id: "sub_1", status: "active" }), "sub_1"));
    subscription.items.data = [];

    expect(subscriptionStateFromStripe(subscription, at(T0), PRICES)).toMatchObject({
      currentPeriodEnd: null,
      currentPeriodStart: null,
      interval: null,
      paidThroughAt: null,
      plan: null,
      priceId: null,
      status: "active",
    });
  });

  it("with several items, reads the plan and period from the one that is a configured plan", async () => {
    const subscription = await read((stripeHas({ customer: "cus_1", id: "sub_1", periodEnd: T0 + 30 * DAY, priceId: "price_standard_monthly", status: "active" }), "sub_1"));
    const planItem = subscription.items.data[0];
    if (!planItem) throw new Error("fixture has no item");
    const addOn = {
      ...planItem,
      current_period_end: T0 + 7 * DAY,
      id: "si_addon",
      price: { ...planItem.price, id: "price_addon_weekly" },
    };
    subscription.items.data = [addOn, planItem];

    expect(subscriptionStateFromStripe(subscription, at(T0), PRICES)).toMatchObject({
      currentPeriodEnd: at(T0 + 30 * DAY),
      plan: "standard",
      priceId: "price_standard_monthly",
    });

    // No configured plan among them: the first item, and no plan name.
    subscription.items.data = [addOn];
    expect(subscriptionStateFromStripe(subscription, at(T0), PRICES)).toMatchObject({
      currentPeriodEnd: at(T0 + 7 * DAY),
      plan: null,
      priceId: "price_addon_weekly",
    });
  });

  it("tolerates an item without period fields (an event rendered by an older API version)", async () => {
    const subscription = await read((stripeHas({ cancelAtPeriodEnd: true, customer: "cus_1", id: "sub_1", status: "active" }), "sub_1"));
    const item = subscription.items.data[0];
    if (!item) throw new Error("fixture has no item");
    Reflect.deleteProperty(item, "current_period_end");
    Reflect.deleteProperty(item, "current_period_start");

    expect(subscriptionStateFromStripe(subscription, at(T0), PRICES)).toMatchObject({
      cancelAt: null,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: null,
      currentPeriodStart: null,
      paidThroughAt: null,
    });
  });

  it("anchors past-due on the unpaid invoice, never later than the reading", async () => {
    stripeHas({ customer: "cus_1", id: "sub_1", status: "past_due" });
    stub.invoices.set("in_sub_1", buildInvoice({ created: T0 + 100, customer: "cus_1", id: "in_sub_1", status: "open", subscriptionId: "sub_1" }));

    expect(pastDueAnchor(await read("sub_1"), at(T0 + 5000))).toEqual(at(T0 + 100));
    expect(pastDueAnchor(await read("sub_1"), at(T0 + 50))).toEqual(at(T0 + 50));
    // Not expanded, or paid: the time of the reading.
    expect(pastDueAnchor(await stub.client.subscriptions.retrieve("sub_1"), at(T0 + 5000))).toEqual(at(T0 + 5000));
  });
});

describe("pickPrimarySubscription", () => {
  const now = at(T0 + 10 * DAY);
  const pick = async (...inputs: StubSubscriptionInput[]) => {
    for (const input of inputs) stripeHas(input);
    const subscriptions = await Promise.all(inputs.map((input) => read(input.id)));
    return pickPrimarySubscription(subscriptions, now, PRICES)?.id ?? null;
  };

  it("returns null for no subscriptions", () => {
    expect(pickPrimarySubscription([], now, PRICES)).toBeNull();
  });

  it("prefers an older paid subscription to a newer incomplete one", async () => {
    expect(
      await pick(
        { created: T0, customer: "cus_1", id: "sub_active", status: "active" },
        { created: T0 + 5 * DAY, customer: "cus_1", id: "sub_incomplete", status: "incomplete" },
      ),
    ).toBe("sub_active");
  });

  it.each(["trialing", "past_due"])("counts %s as entitling", async (status) => {
    expect(
      await pick(
        { created: T0, customer: "cus_1", id: "sub_entitling", status },
        { created: T0 + 5 * DAY, customer: "cus_1", id: "sub_unpaid", status: "unpaid" },
        { created: T0 + 6 * DAY, customer: "cus_1", id: "sub_paused", status: "paused" },
      ),
    ).toBe("sub_entitling");
  });

  it("of two live, entitling subscriptions takes the more recent", async () => {
    expect(
      await pick(
        { created: T0, customer: "cus_1", id: "sub_first", status: "active" },
        { created: T0 + 5 * DAY, customer: "cus_1", id: "sub_second", status: "active" },
      ),
    ).toBe("sub_second");
  });

  it("prefers a cancelled subscription with paid time left to an incomplete one, but not to an active one", async () => {
    const paidRemainder: StubSubscriptionInput = {
      cancellationReason: "cancellation_requested",
      created: T0,
      customer: "cus_1",
      id: "sub_canceled_paid",
      periodEnd: T0 + 30 * DAY,
      status: "canceled",
    };
    const incomplete: StubSubscriptionInput = { created: T0 + 5 * DAY, customer: "cus_1", id: "sub_incomplete", status: "incomplete" };

    expect(await pick(paidRemainder, incomplete)).toBe("sub_canceled_paid");
    expect(await pick(paidRemainder, incomplete, { created: T0 + DAY, customer: "cus_1", id: "sub_active", status: "active" })).toBe("sub_active");
  });

  it("prefers a live, non-entitling subscription to finished ones, and among finished ones the most recent", async () => {
    const finished: StubSubscriptionInput[] = [
      { created: T0, customer: "cus_1", id: "sub_canceled", periodEnd: T0 + DAY, status: "canceled" },
      { created: T0 + 8 * DAY, customer: "cus_1", id: "sub_expired", status: "incomplete_expired" },
    ];

    expect(await pick(...finished)).toBe("sub_expired");
    expect(await pick(...finished, { created: T0 + 2 * DAY, customer: "cus_1", id: "sub_paused", status: "paused" })).toBe("sub_paused");
  });

  it("ranks a cancelled subscription whose period was not paid, or was not requested, as finished", () => {
    const base = { cancellationReason: "cancellation_requested", paidThroughAt: at(T0 + 30 * DAY), status: "canceled" };

    expect(subscriptionPrecedence(base, now)).toBe(2);
    expect(subscriptionPrecedence({ ...base, paidThroughAt: null }, now)).toBe(0);
    expect(subscriptionPrecedence({ ...base, paidThroughAt: now }, now)).toBe(0);
    expect(subscriptionPrecedence({ ...base, cancellationReason: "payment_failed" }, now)).toBe(0);
    expect(subscriptionPrecedence({ ...base, status: "some_future_status" }, now)).toBe(1);
  });
});

describe("disputeStanding", () => {
  it("maps Stripe's dispute statuses", () => {
    expect(["needs_response", "under_review", "appeal_needs_response", "some_future_status"].map(disputeStanding)).toEqual(["open", "open", "open", "open"]);
    expect(["won", "warning_closed", "prevented", "warning_needs_response", "warning_under_review"].map(disputeStanding)).toEqual(["cleared", "cleared", "cleared", "cleared", "cleared"]);
    expect(disputeStanding("lost")).toBe("lost");
  });
});

describe("a second subscription of the same user", () => {
  it("an incomplete new subscription never replaces a row that is paid for", async () => {
    const user = await createCustomerUser();
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_paid", status: "active" });
    await syncSubscriptionById(testDb.db, stub.client, "sub_paid");
    stripeHas({ created: T0 + 5 * DAY, customer: "cus_alice", id: "sub_incomplete", status: "incomplete" });

    const result = await syncSubscriptionById(testDb.db, stub.client, "sub_incomplete");

    expect(result).toMatchObject({ outcome: "stale" });
    expect(await row(user.id)).toMatchObject({ status: "active", subscriptionId: "sub_paid" });
    // Two live subscriptions on one customer is something a person must see.
    expect(errors.mock.calls.flat().join(" ")).toContain("more than one live Stripe subscription");
  });

  it("an incomplete new subscription does not take away the paid remainder of a cancelled one", async () => {
    const user = await createCustomerUser();
    const now = Math.floor(Date.now() / 1000);
    stripeHas({ cancellationReason: "cancellation_requested", created: now - 10 * DAY, customer: "cus_alice", id: "sub_canceled", periodEnd: now + 20 * DAY, periodStart: now - 10 * DAY, status: "canceled" });
    await syncSubscriptionById(testDb.db, stub.client, "sub_canceled");
    stripeHas({ created: now - DAY, customer: "cus_alice", id: "sub_incomplete", status: "incomplete" });

    await syncSubscriptionById(testDb.db, stub.client, "sub_incomplete");

    const stored = await row(user.id);
    expect(stored).toMatchObject({ status: "canceled", subscriptionId: "sub_canceled" });
    expect(entitlementsFor(stored, new Date()).reason).toBe("canceled_paid_period");

    // Once the new one is paid, it is the one.
    stripeHas({ created: now - DAY, customer: "cus_alice", id: "sub_incomplete", status: "active" });
    await syncSubscriptionById(testDb.db, stub.client, "sub_incomplete");
    expect(await row(user.id)).toMatchObject({ status: "active", subscriptionId: "sub_incomplete" });
  });

  it("a newer live subscription replaces a finished one, and drops its dispute and refund markers", async () => {
    const user = await createCustomerUser();
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_old", status: "canceled" });
    await syncSubscriptionById(testDb.db, stub.client, "sub_old");
    await testDb.db.subscription.update({
      data: { disputeId: "dp_1", disputeInvoiceId: "in_sub_old", disputeStatus: "lost", refundedInvoiceId: "in_sub_old" },
      where: { userId: user.id },
    });
    stripeHas({ created: T0 + 50 * DAY, customer: "cus_alice", id: "sub_new", status: "active" });

    expect(await syncSubscriptionById(testDb.db, stub.client, "sub_new")).toMatchObject({ outcome: "applied" });

    expect(await row(user.id)).toMatchObject({
      disputeId: null,
      disputeInvoiceId: null,
      disputeStatus: null,
      refundedInvoiceId: null,
      status: "active",
      subscriptionId: "sub_new",
    });
  });

  it("a delayed reading of another subscription cannot replace the row or move its clock backwards", async () => {
    const user = await createCustomerUser();
    stripeHas({ created: T0 + 50 * DAY, customer: "cus_alice", id: "sub_new", status: "canceled" });
    stripeClock(T0 + 60 * DAY + 10);
    await syncSubscriptionById(testDb.db, stub.client, "sub_new");

    // A handler that read sub_old as "active" five seconds earlier writes now.
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_old", status: "active" });
    const delayed = subscriptionStateFromStripe(await read("sub_old"), at(T0 + 60 * DAY + 5), PRICES);

    expect(await applySubscriptionState(testDb.db, user.id, delayed)).toBe("other_subscription");
    expect(await row(user.id)).toMatchObject({
      status: "canceled",
      stripeSyncedAt: at(T0 + 60 * DAY + 10),
      subscriptionId: "sub_new",
    });

    // Even the authoritative path refuses a reading older than the stored one.
    expect(await applySubscriptionState(testDb.db, user.id, delayed, { authoritative: true })).toBe("other_subscription");
    expect((await row(user.id)).subscriptionId).toBe("sub_new");

    // What settles it is current data: the customer's list, read now.
    stripeClock(T0 + 60 * DAY + 20);
    await syncSubscriptionById(testDb.db, stub.client, "sub_old");
    expect(await row(user.id)).toMatchObject({ status: "active", stripeSyncedAt: at(T0 + 60 * DAY + 20), subscriptionId: "sub_old" });
  });

  it("leaves the row alone when the subscription is on a customer other than the user's stored one", async () => {
    const user = await createCustomerUser();
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_mine", status: "canceled" });
    await syncSubscriptionById(testDb.db, stub.client, "sub_mine");
    stub.customers.set("cus_other", { id: "cus_other", metadata: {}, object: "customer" });
    stripeHas({ created: T0 + DAY, customer: "cus_other", id: "sub_other", metadata: { userId: user.id }, status: "active" });

    expect(await syncSubscriptionById(testDb.db, stub.client, "sub_other")).toMatchObject({ outcome: "stale" });
    expect((await row(user.id)).subscriptionId).toBe("sub_mine");
  });
});

describe("two readings in the same second", () => {
  it("a delayed `active` reading cannot overwrite `canceled` read in the same second: the subscription is read again", async () => {
    const user = await createCustomerUser();
    const second = T0 + 40 * DAY;
    stripeHas({ cancellationReason: "payment_failed", customer: "cus_alice", id: "sub_1", status: "canceled" });
    stripeClock(second);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");

    // The delayed handler's read was answered in that same second, when the
    // subscription was still active; its write happens only now.
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const delayed = subscriptionStateFromStripe(await read("sub_1"), at(second), PRICES);
    expect(await applySubscriptionState(testDb.db, user.id, delayed)).toBe("tie");
    expect((await row(user.id)).status).toBe("canceled");

    // Through the sync: the first read is the stale one, the re-read (a
    // second later on Stripe's clock) says what is true.
    let reads = 0;
    stub.onRequest((request) => {
      if (request.method !== "GET" || !request.path.endsWith("/subscriptions/sub_1")) return;
      reads += 1;
      if (reads === 2) {
        stripeHas({ cancellationReason: "payment_failed", customer: "cus_alice", id: "sub_1", status: "canceled" });
        stripeClock(second + 1);
      }
    });
    const { sleep, waits } = instantSleep();

    const result = await syncSubscriptionById(testDb.db, stub.client, "sub_1", null, { now: () => second * 1000 + 400, sleep });

    expect(result).toMatchObject({ outcome: "applied", state: { status: "canceled" } });
    expect(reads).toBe(2);
    expect(waits).toEqual([700]); // to the end of the tied second, plus a margin
    const stored = await row(user.id);
    expect(stored).toMatchObject({ status: "canceled", stripeSyncedAt: at(second + 1) });
    expect(entitlementsFor(stored, new Date()).hasProAccess).toBe(false);
  });

  it("an `incomplete` reading cannot overwrite `active` read in the same second", async () => {
    const user = await createCustomerUser();
    const second = T0 + DAY;
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    stripeClock(second);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");

    stripeHas({ customer: "cus_alice", id: "sub_1", status: "incomplete" });
    const older = subscriptionStateFromStripe(await read("sub_1"), at(second), PRICES);

    expect(await applySubscriptionState(testDb.db, user.id, older)).toBe("tie");
    expect(await row(user.id)).toMatchObject({ isActive: true, status: "active" });
  });

  it("a genuine change within one second is not dropped: it is stored from the next reading", async () => {
    const user = await createCustomerUser();
    const second = T0 + DAY;
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "incomplete" });
    stripeClock(second);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");

    // Paid within the same second; Stripe's clock moves on while we wait.
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const { sleep } = instantSleep();
    const waiting = { sleep: async (ms: number) => (stripeClock(second + 1), sleep(ms)) };

    expect(await syncSubscriptionById(testDb.db, stub.client, "sub_1", null, waiting)).toMatchObject({ outcome: "applied" });
    expect(await row(user.id)).toMatchObject({ status: "active", stripeSyncedAt: at(second + 1) });
  });

  it("the same reading twice in one second is simply stored (no re-read)", async () => {
    await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    stripeClock(T0 + DAY);
    const { sleep, waits } = instantSleep();

    await syncSubscriptionById(testDb.db, stub.client, "sub_1", null, { sleep });
    const again = await syncSubscriptionById(testDb.db, stub.client, "sub_1", null, { sleep });

    expect(again).toMatchObject({ outcome: "applied" });
    expect(waits).toEqual([]);
  });

  it("gives up with an error (the webhook answers 500) if re-reading never settles it", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    stripeClock(T0 + DAY);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "past_due" });
    const { sleep, waits } = instantSleep();

    // Stripe's clock is stuck: every reading bears the same second.
    await expect(syncSubscriptionById(testDb.db, stub.client, "sub_1", null, { sleep })).rejects.toBeInstanceOf(UnorderedReadingsError);

    expect(waits).toHaveLength(2);
    expect((await row(user.id)).status).toBe("active");
  });

  it("a delayed reading that differs only in the cancellation date cannot restore the old date", async () => {
    const user = await createCustomerUser();
    const second = T0 + 12 * DAY;
    const newDate = T0 + 30 * DAY;
    const oldDate = T0 + 20 * DAY;
    stripeHas({ cancelAt: newDate, customer: "cus_alice", id: "sub_1", status: "active" });
    stripeClock(second);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");

    // Read in that same second, when the cancellation was still set for the
    // earlier date; status, period, invoice and the cancel flag all match.
    stripeHas({ cancelAt: oldDate, customer: "cus_alice", id: "sub_1", status: "active" });
    const delayed = subscriptionStateFromStripe(await read("sub_1"), at(second), PRICES);

    expect(await applySubscriptionState(testDb.db, user.id, delayed)).toBe("tie");
    expect(await row(user.id)).toMatchObject({ cancelAt: at(newDate), cancelAtPeriodEnd: true });
  });

  it("a customer-list reading for ANOTHER subscription cannot replace a selection made in the same second", async () => {
    const user = await createCustomerUser();
    const second = T0 + 60 * DAY;
    stripeHas({ created: T0 + 50 * DAY, customer: "cus_alice", id: "sub_new", status: "active" });
    stripeClock(second);
    await syncUserFromStripe(testDb.db, stub.client, user.id);
    expect((await row(user.id)).subscriptionId).toBe("sub_new");

    // A list read in that same second, before sub_new existed, chose sub_old.
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_old", status: "active" });
    const delayed = subscriptionStateFromStripe(await read("sub_old"), at(second), PRICES);

    expect(await applySubscriptionState(testDb.db, user.id, delayed, { authoritative: true })).toBe("tie");
    expect(await row(user.id)).toMatchObject({ stripeSyncedAt: at(second), subscriptionId: "sub_new" });

    // A list read after that second is strictly newer and may choose.
    stub.subscriptions.delete("sub_new");
    stripeClock(second + 1);
    expect(await syncUserFromStripe(testDb.db, stub.client, user.id)).toMatchObject({ outcome: "applied" });
    expect((await row(user.id)).subscriptionId).toBe("sub_old");
  });

  it("a reading taken earlier never replaces one taken later", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    const older = subscriptionStateFromStripe(await read("sub_1"), at(T0 + 5), PRICES);
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "canceled" });
    const newer = subscriptionStateFromStripe(await read("sub_1"), at(T0 + 10), PRICES);

    expect(await applySubscriptionState(testDb.db, user.id, newer)).toBe("applied");
    expect(await applySubscriptionState(testDb.db, user.id, older)).toBe("stale");
    expect(await row(user.id)).toMatchObject({ status: "canceled", stripeSyncedAt: at(T0 + 10) });
  });
});

describe("pastDueSince", () => {
  const periodOne = T0 + 30 * DAY;

  it("is set at the first failure, kept across new periods, and cleared on recovery", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "active" });
    stripeClock(T0 + DAY);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");
    expect((await row(user.id)).pastDueSince).toBeNull();

    // The renewal's invoice (created at the start of the period) failed.
    stripeHas({ customer: "cus_alice", id: "sub_1", latestInvoice: "in_2", periodStart: periodOne, status: "past_due" });
    stub.invoices.set("in_2", buildInvoice({ created: periodOne, customer: "cus_alice", id: "in_2", status: "open", subscriptionId: "sub_1" }));
    stripeClock(periodOne + 3600);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");
    expect(await row(user.id)).toMatchObject({ paidThroughAt: null, pastDueSince: at(periodOne), status: "past_due" });

    // Still past due a retry later: the anchor stays.
    stripeClock(periodOne + 3 * DAY);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");
    expect((await row(user.id)).pastDueSince).toEqual(at(periodOne));

    // Stripe left it past due and opened the next period, with a new invoice.
    const periodTwo = periodOne + 30 * DAY;
    stripeHas({ customer: "cus_alice", id: "sub_1", latestInvoice: "in_3", periodStart: periodTwo, status: "past_due" });
    stub.invoices.set("in_3", buildInvoice({ created: periodTwo, customer: "cus_alice", id: "in_3", status: "open", subscriptionId: "sub_1" }));
    stripeClock(periodTwo + 3600);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");
    const secondPeriod = await row(user.id);
    expect(secondPeriod).toMatchObject({ currentPeriodStart: at(periodTwo), latestInvoiceId: "in_3", pastDueSince: at(periodOne) });
    // 21 days from the FIRST failure have passed: no access, new period or not.
    expect(entitlementsFor(secondPeriod, at(periodTwo + 3600))).toMatchObject({ hasProAccess: false, isPastDue: true });
    expect(entitlementsFor(secondPeriod, at(periodOne + (PAST_DUE_GRACE_DAYS - 1) * DAY)).hasProAccess).toBe(true);

    // The list-based sync keeps the anchor too.
    stripeClock(periodTwo + 2 * 3600);
    await syncUserFromStripe(testDb.db, stub.client, user.id);
    expect((await row(user.id)).pastDueSince).toEqual(at(periodOne));

    // Paid: active again, anchor cleared.
    stripeHas({ customer: "cus_alice", id: "sub_1", latestInvoice: "in_3", periodStart: periodTwo, status: "active" });
    stub.invoices.set("in_3", buildInvoice({ customer: "cus_alice", id: "in_3", status: "paid", subscriptionId: "sub_1" }));
    stripeClock(periodTwo + DAY);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");
    expect(await row(user.id)).toMatchObject({ pastDueSince: null, status: "active" });

    // A later failure starts a new window from its own date.
    const periodThree = periodTwo + 30 * DAY;
    stripeHas({ customer: "cus_alice", id: "sub_1", latestInvoice: "in_4", periodStart: periodThree, status: "past_due" });
    stub.invoices.set("in_4", buildInvoice({ created: periodThree, customer: "cus_alice", id: "in_4", status: "open", subscriptionId: "sub_1" }));
    stripeClock(periodThree + 3600);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");
    expect((await row(user.id)).pastDueSince).toEqual(at(periodThree));
  });

  it("falls back to the time of the reading when the invoice says nothing, and is cleared by any other status", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "past_due" });
    stub.invoices.set("in_sub_1", buildInvoice({ customer: "cus_alice", id: "in_sub_1", status: "paid", subscriptionId: "sub_1" }));
    stripeClock(T0 + 50 * DAY);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");
    expect((await row(user.id)).pastDueSince).toEqual(at(T0 + 50 * DAY));

    stripeHas({ customer: "cus_alice", id: "sub_1", status: "unpaid" });
    stripeClock(T0 + 80 * DAY);
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");
    expect(await row(user.id)).toMatchObject({ pastDueSince: null, status: "unpaid" });
  });

  it("a legacy row that says past_due without an anchor gets one from Stripe; until then it has no access", async () => {
    const user = await createCustomerUser();
    await testDb.db.subscription.create({
      data: { isActive: true, isCanceled: false, isExpired: false, isLifetime: false, isPaused: false, isPending: false, isTrial: false, status: "past_due", subscriptionId: "sub_1", userId: user.id },
    });
    expect(entitlementsFor(await row(user.id), new Date()).hasProAccess).toBe(false);

    const failedAt = Math.floor(Date.now() / 1000) - 5 * DAY;
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "past_due" });
    stub.invoices.set("in_sub_1", buildInvoice({ created: failedAt, customer: "cus_alice", id: "in_sub_1", status: "open", subscriptionId: "sub_1" }));
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");

    expect((await row(user.id)).pastDueSince).toEqual(at(failedAt));
  });
});

describe("syncUserFromStripe", () => {
  it("finds an older live subscription behind more newer cancelled ones than a page holds", async () => {
    const user = await createCustomerUser();
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_live", status: "active" });
    for (let i = 1; i <= 25; i += 1) {
      stripeHas({ created: T0 + i * DAY, customer: "cus_alice", endedAt: T0 + i * DAY + 60, id: `sub_canceled_${i}`, status: "canceled" });
    }

    const result = await syncUserFromStripe(testDb.db, stub.client, user.id);

    expect(result).toMatchObject({ hasLiveSubscription: true, outcome: "applied" });
    expect(await row(user.id)).toMatchObject({ status: "active", subscriptionId: "sub_live" });
  });

  it("follows has_more to the end of the subscriptions that are not cancelled", async () => {
    const user = await createCustomerUser();
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_live", status: "past_due" });
    for (let i = 1; i <= 101; i += 1) {
      stripeHas({ created: T0 + i * DAY, customer: "cus_alice", id: `sub_expired_${i}`, status: "incomplete_expired" });
    }

    await syncUserFromStripe(testDb.db, stub.client, user.id);

    const pages = stub.requests.filter((request) => request.path === "/v1/subscriptions" && request.params.status === undefined);
    expect(pages.map((request) => request.params.starting_after)).toEqual([undefined, "sub_expired_2"]);
    expect(await row(user.id)).toMatchObject({ status: "past_due", subscriptionId: "sub_live" });
  });

  it("concludes and stores nothing from a truncated list: an active subscription may be beyond the page limit", async () => {
    const user = await createCustomerUser();
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_active", status: "active" });
    for (let i = 1; i <= 4; i += 1) {
      stripeHas({ created: T0 + i * DAY, customer: "cus_alice", id: `sub_newer_${i}`, status: "incomplete_expired" });
    }
    const listing = { maxPages: 2, pageSize: 2 };

    // No row yet: nothing is created from the four that were read.
    expect(await syncUserFromStripe(testDb.db, stub.client, user.id, { listing })).toEqual({ outcome: "listing_truncated" });
    expect(await testDb.db.subscription.count()).toBe(0);
    expect(errors.mock.calls.flat().join(" ")).toContain("more subscriptions than are read");

    // A row that exists is not replaced by a lower-ranking one from the partial list.
    await syncSubscriptionById(testDb.db, stub.client, "sub_active");
    const before = await row(user.id);
    expect(await syncUserFromStripe(testDb.db, stub.client, user.id, { listing })).toEqual({ outcome: "listing_truncated" });
    expect(await row(user.id)).toEqual(before);

    // The cancelled list is read to the end too, and is subject to the same limit.
    for (let i = 1; i <= 4; i += 1) stub.subscriptions.delete(`sub_newer_${i}`);
    for (let i = 1; i <= 5; i += 1) {
      stripeHas({ created: T0 + i * DAY, customer: "cus_alice", id: `sub_ended_${i}`, status: "canceled" });
    }
    expect(await syncUserFromStripe(testDb.db, stub.client, user.id, { listing })).toEqual({ outcome: "listing_truncated" });
    expect(await syncUserFromStripe(testDb.db, stub.client, user.id)).toMatchObject({ outcome: expect.stringMatching(/applied|stale/), state: { subscriptionId: "sub_active" } });
  });

  it("two syncs for one customer run one after the other, never interleaved", async () => {
    const user = await createCustomerUser();
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_1", status: "active" });
    await syncSubscriptionById(testDb.db, stub.client, "sub_1");
    stub.requests.length = 0;
    let inFlight = 0;
    let mostAtOnce = 0;
    stub.onRequest(async () => {
      inFlight += 1;
      mostAtOnce = Math.max(mostAtOnce, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
    });

    await Promise.all([
      syncSubscriptionById(testDb.db, stub.client, "sub_1"),
      syncUserFromStripe(testDb.db, stub.client, user.id),
      syncSubscriptionById(testDb.db, stub.client, "sub_1", null, { customerId: "cus_alice" }),
    ]);

    expect(mostAtOnce).toBe(1);
    expect(stub.requests.length).toBeGreaterThanOrEqual(4);
    expect(await testDb.raw.billingLease.count()).toBe(0);
  });

  it("with nothing live, shows the most recent finished subscription", async () => {
    const user = await createCustomerUser();
    stripeHas({ created: T0, customer: "cus_alice", id: "sub_a", status: "canceled" });
    stripeHas({ created: T0 + 9 * DAY, customer: "cus_alice", id: "sub_b", status: "canceled" });

    expect(await syncUserFromStripe(testDb.db, stub.client, user.id)).toMatchObject({ hasLiveSubscription: false });
    expect((await row(user.id)).subscriptionId).toBe("sub_b");
  });

  it("stores a status this code does not know verbatim, without access, and reports it", async () => {
    const user = await createCustomerUser();
    stripeHas({ customer: "cus_alice", id: "sub_1", status: "some_future_status" });

    expect(await syncUserFromStripe(testDb.db, stub.client, user.id)).toMatchObject({ hasLiveSubscription: true, outcome: "applied" });

    const stored = await row(user.id);
    expect(stored.status).toBe("some_future_status");
    expect(entitlementsFor(stored, new Date()).hasProAccess).toBe(false);
    expect(errors.mock.calls.flat().join(" ")).toContain("a status this app does not know");
  });
});
