import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as StripeModule from "~/server/_billing/stripe";
import { buildSubscription, startStripeStub, type StripeStub } from "~/test/helpers/stripeStub";

const stripeRef = vi.hoisted((): { stub: { client: unknown } | null } => ({ stub: null }));
vi.mock("~/server/_billing/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof StripeModule>()),
  getStripe: () => stripeRef.stub?.client,
}));
const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("~/server/_lib/email", () => ({ sendEmail: email.sendEmail }));
vi.mock("~/server/_lib/emails/account-deleted", () => ({
  renderAccountDeletedEmail: vi.fn(async (props: { firstName: string; supportEmail: string }) =>
    `<p>${props.firstName} ${props.supportEmail}</p>`,
  ),
}));
vi.mock("~/_lib/site", () => ({ SUPPORT_EMAIL: "help@example.test" }));
const envRef = vi.hoisted(() => ({
  env: {
    CLOUDINARY_API_KEY: "key",
    CLOUDINARY_API_SECRET: "secret",
    CLOUDINARY_CLOUD_NAME: "test-cloud",
    RESEND_API_KEY: undefined as string | undefined,
  },
}));
vi.mock("~/env", () => envRef);
const realtime = vi.hoisted(() => ({ revokeRealtimeAccess: vi.fn(async () => 2) }));
vi.mock("./realtime", () => realtime);
const posthog = vi.hoisted(() => ({ erasePostHogPerson: vi.fn(async () => "skipped" as const) }));
vi.mock("./posthogErasure", () => posthog);

import { accountDeletionDeps, canSendDeletionEmail } from "./deletionDeps";

let stub: StripeStub;

beforeAll(async () => {
  stub = await startStripeStub();
  stripeRef.stub = stub;
});

afterAll(async () => {
  await stub.close();
});

beforeEach(() => {
  stub.reset();
  vi.clearAllMocks();
});

describe("accountDeletionDeps", () => {
  it("ends billing through Stripe", async () => {
    stub.subscriptions.set("sub_live", buildSubscription({ customer: "cus_1", id: "sub_live", status: "active" }));
    await accountDeletionDeps.endBilling("sub_live");
    expect(stub.subscriptions.get("sub_live")?.status).toBe("canceled");
  });

  it("deletes images through Cloudinary with the configured credentials", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await accountDeletionDeps.deleteImages(["https://res.cloudinary.com/test-cloud/image/upload/v1/u/a.jpg"]);
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it("closes chat sockets and erases analytics through their modules", async () => {
    await accountDeletionDeps.revokeRealtime("user_1", ["t1"]);
    expect(realtime.revokeRealtimeAccess).toHaveBeenCalledWith("user_1", ["t1"]);
    await expect(accountDeletionDeps.eraseAnalytics("user_1")).resolves.toBe("skipped");
    expect(posthog.erasePostHogPerson).toHaveBeenCalledWith("user_1");
  });

  it("sends the confirmation email with the support address", async () => {
    email.sendEmail.mockResolvedValue({ isErr: false, isOk: true, value: { success: true } });
    await accountDeletionDeps.sendConfirmation({ email: "ann@example.com", firstName: "Ann" });
    expect(email.sendEmail).toHaveBeenCalledWith({
      email: "ann@example.com",
      html: "<p>Ann help@example.test</p>",
      subject: "Your ISO account has been deleted",
    });
  });

  it("throws when the email cannot be sent", async () => {
    email.sendEmail.mockResolvedValue({ error: new Error("no key"), isErr: true, isOk: false });
    await expect(
      accountDeletionDeps.sendConfirmation({ email: "ann@example.com", firstName: "Ann" }),
    ).rejects.toThrow("no key");
  });
});

describe("canSendDeletionEmail", () => {
  it("follows whether Resend is configured", () => {
    envRef.env.RESEND_API_KEY = undefined;
    expect(canSendDeletionEmail()).toBe(false);
    envRef.env.RESEND_API_KEY = "re_test";
    expect(canSendDeletionEmail()).toBe(true);
  });
});
