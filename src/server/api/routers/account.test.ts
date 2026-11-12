import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { finishAccountDeletions } from "~/server/_jobs/finishAccountDeletions";
import type * as PosthogModule from "~/server/_lib/posthog";
import { seedAccount } from "~/test/helpers/accountFixture";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import { appRouter } from "../root";
import { accountRouter, deletionConfirmationMatches } from "./account";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
const posthog = vi.hoisted(() => ({ captureServerException: vi.fn() }));
vi.mock("~/server/_lib/posthog", async (importOriginal) => ({
  ...(await importOriginal<typeof PosthogModule>()),
  captureEvent: vi.fn(),
  captureServerException: posthog.captureServerException,
}));
const deps = vi.hoisted(() => ({
  deleteImages: vi.fn(async (_urls: string[]) => undefined),
  endBilling: vi.fn(async (_id: string) => undefined),
  eraseAnalytics: vi.fn(async (_userId: string) => "requested"),
  revokeRealtime: vi.fn(async (_userId: string, _threads: string[]) => undefined),
  sendConfirmation: vi.fn(async (_to: { email: string; firstName: string }) => undefined),
}));
vi.mock("~/server/_lib/account/deletionDeps", () => ({ accountDeletionDeps: deps, canSendDeletionEmail: () => true }));

freezeRateLimitClock();

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const callerFor = (user: { email: string; id: string }, headers?: Record<string, string>) =>
  createDbCaller(accountRouter, testDb.db, {
    headers: new Headers({ "cf-connecting-ip": "203.0.113.20", ...headers }),
    user,
  });

describe("deletionConfirmationMatches", () => {
  it("wants the username, ignoring case, spaces and a leading @", () => {
    const user = { email: "ann@example.com", handle: "ann-lee" };
    expect(deletionConfirmationMatches(user, "ann-lee")).toBe(true);
    expect(deletionConfirmationMatches(user, " @Ann-Lee ")).toBe(true);
    expect(deletionConfirmationMatches(user, "ann")).toBe(false);
    expect(deletionConfirmationMatches(user, "ann@example.com")).toBe(false);
  });

  it("wants the email address when there is no username", () => {
    const user = { email: "ann@example.com", handle: null };
    expect(deletionConfirmationMatches(user, "ANN@example.com")).toBe(true);
    expect(deletionConfirmationMatches(user, "")).toBe(false);
  });
});

describe("account.exportData", () => {
  it("returns the caller's own data with the consent of the request", async () => {
    const { member } = await seedAccount(testDb.db);
    const data = await callerFor(member, {
      cookie: "iso_consent=granted",
      "x-iso-country": "DE",
    }).exportData();
    expect(data.account.id).toBe(member.id);
    expect(data.consent).toEqual({ choice: "granted", optInRegion: true });
  });

  it("is rate limited", async () => {
    const user = await createTestUser(testDb.db);
    const caller = callerFor(user);
    for (let i = 0; i < 5; i++) await caller.exportData();
    await expect(caller.exportData()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("account.deleteAccount", () => {
  it("refuses a wrong confirmation and changes nothing", async () => {
    const { member } = await seedAccount(testDb.db);
    const error = await callerFor(member)
      .deleteAccount({ confirmation: "someone-else" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: "BAD_REQUEST", message: "Type your username exactly to confirm." });
    await expect(testDb.db.user.findUnique({ where: { id: member.id } })).resolves.not.toBeNull();
  });

  it("asks for the email address from a member without a username", async () => {
    const user = await createTestUser(testDb.db);
    await expect(callerFor(user).deleteAccount({ confirmation: "nope" })).rejects.toMatchObject({
      message: "Type your email address exactly to confirm.",
    });
    await expect(callerFor(user).deleteAccount({ confirmation: user.email })).resolves.toEqual({
      status: "deleted",
    });
  });

  it("deletes the account when the username is typed", async () => {
    const { member } = await seedAccount(testDb.db);
    await expect(
      callerFor(member).deleteAccount({ confirmation: member.handle ?? "" }),
    ).resolves.toEqual({ status: "deleted" });

    const row = await testDb.raw.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(deps.endBilling).toHaveBeenCalledWith(`sub_${member.id}`);
    expect(deps.sendConfirmation).toHaveBeenCalledWith({ email: member.email, firstName: "Ann" });

    // The account is gone: a second request finds nothing.
    await expect(callerFor(member).deleteAccount({ confirmation: member.handle ?? "" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("closes the account even when a step fails, and the job finishes it", async () => {
    const { member } = await seedAccount(testDb.db);
    deps.endBilling.mockRejectedValueOnce(new Error("Stripe is down"));

    await expect(
      callerFor(member).deleteAccount({ confirmation: member.handle ?? "" }),
    ).resolves.toEqual({ status: "scheduled" });
    expect(posthog.captureServerException).toHaveBeenCalledWith(expect.any(Error), {
      path: "account.deleteAccount",
      source: "account-deletion",
    });
    await expect(testDb.db.user.findUnique({ where: { id: member.id } })).resolves.toBeNull();

    // The job's default dependencies are the app's (mocked here).
    const later = new Date(Date.now() + 60 * 60 * 1000);
    const summary = await finishAccountDeletions(testDb.db, later);
    expect(summary.stuck).toBe(0);
    expect(summary.finished).toBeGreaterThanOrEqual(1);
    const row = await testDb.raw.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it("hides the public profile, search results and events at once, even when a later step fails", async () => {
    const { member, ownEvent } = await seedAccount(testDb.db);
    const handle = member.handle ?? "";
    const viewer = await createTestUser(testDb.db);
    const app = (user?: { email: string; id: string }) =>
      createDbCaller(appRouter, testDb.db, { headers: new Headers({ "cf-connecting-ip": "203.0.113.21" }), user });

    // Visible before.
    expect(await app().photographer.getByUsername({ username: handle })).not.toBeNull();
    deps.deleteImages.mockRejectedValueOnce(new Error("Cloudinary is down"));

    await expect(callerFor(member).deleteAccount({ confirmation: handle })).resolves.toEqual({ status: "scheduled" });

    // The profile page and its metadata and preview image (all `user: { handle }` lookups).
    expect(await app().photographer.getByUsername({ username: handle })).toBeNull();
    expect(await testDb.db.photographer.findFirst({ where: { user: { handle } } })).toBeNull();
    // Search, by name and by event.
    const results = await app(viewer).search.searchAll({ query: "Ann Lee" });
    expect(results.photographers.map((row) => row.userId)).not.toContain(member.id);
    const events = await app(viewer).search.searchAll({ query: "Smith wedding" });
    expect(events.events.map((event) => event.id)).not.toContain(ownEvent.id);
    expect(await testDb.db.event.findFirst({ where: { id: ownEvent.id } })).toBeNull();
  });
});
