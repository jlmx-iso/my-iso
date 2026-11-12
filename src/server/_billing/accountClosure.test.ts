import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";
import { buildInvoice, buildSubscription, startStripeStub, type StripeStub } from "~/test/helpers/stripeStub";

import { endBillingForClosedAccount, isClosedAccount } from "./accountClosure";

let stub: StripeStub;
let testDb: TestDb;

beforeAll(async () => {
  stub = await startStripeStub();
  testDb = await createTestDb();
});

afterAll(async () => {
  await stub.close();
  await testDb.close();
});

beforeEach(() => {
  stub.reset();
});

describe("isClosedAccount", () => {
  it("is true only for a deleted account", async () => {
    const live = await createTestUser(testDb.db);
    const gone = await createTestUser(testDb.db);
    await testDb.raw.user.update({ data: { isDeleted: true }, where: { id: gone.id } });
    expect(await isClosedAccount(testDb.db, live.id)).toBe(false);
    expect(await isClosedAccount(testDb.db, gone.id)).toBe(true);
    expect(await isClosedAccount(testDb.db, "nobody")).toBe(false);
  });
});

describe("endBillingForClosedAccount", () => {
  it("cancels a live subscription and voids only its open invoices", async () => {
    stub.subscriptions.set("sub_1", buildSubscription({ customer: "cus_1", id: "sub_1", status: "active" }));
    stub.invoices.set("in_open", buildInvoice({ customer: "cus_1", id: "in_open", status: "open", subscriptionId: "sub_1" }));
    stub.invoices.set("in_other", buildInvoice({ customer: "cus_1", id: "in_other", status: "open", subscriptionId: "sub_2" }));

    await endBillingForClosedAccount(stub.client, "sub_1");

    expect(stub.subscriptions.get("sub_1")?.status).toBe("canceled");
    expect(stub.invoices.get("in_open")?.status).toBe("void");
    expect(stub.invoices.get("in_other")?.status).toBe("open");

    // Again: nothing left to do, and no error.
    const before = stub.requests.length;
    await endBillingForClosedAccount(stub.client, "sub_1");
    expect(stub.requests.slice(before).filter((request) => request.method !== "GET")).toHaveLength(0);
  });

  it("still voids an open invoice of a subscription that has already ended", async () => {
    stub.subscriptions.set("sub_1", buildSubscription({ customer: "cus_1", id: "sub_1", status: "canceled" }));
    stub.invoices.set("in_open", buildInvoice({ customer: "cus_1", id: "in_open", status: "open", subscriptionId: "sub_1" }));
    await endBillingForClosedAccount(stub.client, "sub_1");
    expect(stub.requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(stub.invoices.get("in_open")?.status).toBe("void");
  });

  it("does nothing for a subscription Stripe does not know, and throws on other errors", async () => {
    await expect(endBillingForClosedAccount(stub.client, "sub_unknown")).resolves.toBeUndefined();
    stub.subscriptions.set("sub_1", buildSubscription({ customer: "cus_1", id: "sub_1", status: "active" }));
    stub.failNext(1, 500);
    await expect(endBillingForClosedAccount(stub.client, "sub_1")).rejects.toThrow();
  });
});
