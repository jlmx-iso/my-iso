import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimits } from "~/server/_utils/rateLimit";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock, spendRateLimit } from "~/test/helpers/rateLimitClock";
import { createTestDb, type TestDb } from "~/test/helpers/sqlite";

const mockSendTemplateEmail = vi.hoisted(() => vi.fn());
const mockCaptureEvent = vi.hoisted(() => vi.fn());

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/server/_lib/posthog", () => ({ captureEvent: mockCaptureEvent }));
vi.mock("~/server/_lib/email", () => ({ sendTemplateEmail: mockSendTemplateEmail }));
// Background tasks run inline, so a test can see the email that was "sent".
vi.mock("~/server/_lib/background", () => ({
  runAfterResponse: (_name: string, task: () => Promise<unknown>) => {
    void task();
  },
}));

import { waitlistRouter } from "./waitlist";

const limiterClock = freezeRateLimitClock();

describe("waitlist.submit against SQLite", () => {
  let testDb: TestDb;
  let ipCounter = 0;

  /** A caller from a fresh IP address, so the per-IP submit limit never interferes. */
  const visitor = () => {
    ipCounter += 1;
    return createDbCaller(waitlistRouter, testDb.db, {
      headers: new Headers({ "cf-connecting-ip": `198.51.100.${ipCounter}` }),
    });
  };

  const application = { email: "jane@example.com", name: "Jane Smith", userType: "both" as const };

  beforeEach(async () => {
    testDb = await createTestDb();
    ipCounter = 0;
    mockSendTemplateEmail.mockReset();
    mockSendTemplateEmail.mockResolvedValue({ isErr: false, isOk: true, value: {} });
    mockCaptureEvent.mockReset();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("adds a new address, in order, and emails the confirmation", async () => {
    await visitor().submit({ ...application, email: "first@example.com" });

    const result = await visitor().submit({ ...application, email: "Jane@Example.com" });

    expect(result).toEqual({ position: null, success: true });
    expect(await testDb.db.waitlist.findUnique({ where: { email: "jane@example.com" } })).toMatchObject({
      name: "Jane Smith",
      position: 2,
      status: "pending",
    });
    expect(mockSendTemplateEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "jane@example.com", template: "waitlist-confirmation" }),
    );
  });

  it("answers exactly the same for an address that is already on the list", async () => {
    const first = await visitor().submit(application);

    const repeat = await visitor().submit({ ...application, name: "Someone Else" });

    expect(repeat).toEqual(first);
    expect(await testDb.db.waitlist.count()).toBe(1);
    // The stored application is not overwritten by the repeat.
    expect((await testDb.db.waitlist.findFirstOrThrow()).name).toBe("Jane Smith");
  });

  it("answers the same whatever the state of the existing entry", async () => {
    const fresh = await visitor().submit({ ...application, email: "new@example.com" });
    for (const status of ["pending", "approved", "rejected"]) {
      await testDb.db.waitlist.create({
        data: { email: `${status}@example.com`, name: "Existing", position: 99, status },
      });

      expect(await visitor().submit({ ...application, email: `${status}@example.com` })).toEqual(fresh);
    }
  });

  it("re-sends the confirmation to an existing address at most once a day", async () => {
    await visitor().submit(application);
    expect(mockSendTemplateEmail).toHaveBeenCalledTimes(1);

    await visitor().submit(application);
    await visitor().submit(application);
    await visitor().submit(application);

    // One for the original application, one re-send; the rest are silent.
    expect(mockSendTemplateEmail).toHaveBeenCalledTimes(2);
    expect(mockSendTemplateEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ props: { name: "Jane Smith" } }),
    );

    limiterClock.advance(RateLimits.WAITLIST_RECONFIRM_EMAIL.windowSeconds);
    await visitor().submit(application);
    expect(mockSendTemplateEmail).toHaveBeenCalledTimes(3);
  });

  it("does not re-send to an address that has already been reviewed", async () => {
    await testDb.db.waitlist.create({
      data: { email: "approved@example.com", name: "In", position: 1, status: "approved" },
    });

    await visitor().submit({ ...application, email: "approved@example.com" });

    expect(mockSendTemplateEmail).not.toHaveBeenCalled();
  });

  it("stores one entry when the same address is submitted twice at once", async () => {
    const results = await Promise.all([visitor().submit(application), visitor().submit(application)]);

    expect(results).toEqual([
      { position: null, success: true },
      { position: null, success: true },
    ]);
    expect(await testDb.db.waitlist.count()).toBe(1);
  });

  describe("losing the race for an address (the other submission's insert got in first)", () => {
    /** The next submission's first look finds nothing, as it would mid-race. */
    const loseTheRace = () => vi.spyOn(testDb.db.waitlist, "findUnique").mockResolvedValueOnce(null);

    it("confirms with the name that was stored, not the one this request submitted", async () => {
      await visitor().submit(application);
      mockSendTemplateEmail.mockClear();
      loseTheRace();

      const result = await visitor().submit({ ...application, name: "Someone Else" });

      expect(result).toEqual({ position: null, success: true });
      expect(await testDb.db.waitlist.count()).toBe(1);
      expect(mockSendTemplateEmail).toHaveBeenCalledTimes(1);
      expect(mockSendTemplateEmail.mock.calls[0]?.[0]).toMatchObject({ props: { name: "Jane Smith" } });
      // A repeat, so not reported as a new application.
      expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
    });

    it("uses the stored status: no confirmation for an entry that is no longer pending", async () => {
      await visitor().submit(application);
      await testDb.db.waitlist.update({ data: { status: "approved" }, where: { email: application.email } });
      mockSendTemplateEmail.mockClear();
      loseTheRace();

      await visitor().submit({ ...application, name: "Someone Else" });

      expect(mockSendTemplateEmail).not.toHaveBeenCalled();
    });

    it("fails instead of pretending when the insert was refused but no entry exists", async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        clientVersion: "test",
        code: "P2002",
      });
      vi.spyOn(testDb.db.waitlist, "create").mockRejectedValueOnce(conflict);

      await expect(visitor().submit(application)).rejects.toBeDefined();

      expect(await testDb.db.waitlist.count()).toBe(0);
      expect(mockSendTemplateEmail).not.toHaveBeenCalled();
    });
  });

  it("reports a new application to analytics by hash, and not a repeat", async () => {
    await visitor().submit(application);
    await visitor().submit(application);

    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
    const [distinctId] = mockCaptureEvent.mock.calls[0] as [string, ...unknown[]];
    expect(distinctId).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(mockCaptureEvent.mock.calls)).not.toContain(application.email);
  });

  it("succeeds even when the confirmation email cannot be sent", async () => {
    mockSendTemplateEmail.mockResolvedValue({ error: new Error("smtp down"), isErr: true, isOk: false });

    await expect(visitor().submit(application)).resolves.toEqual({ position: null, success: true });
  });

  it("is rate limited per IP address", async () => {
    const caller = visitor();
    await spendRateLimit(testDb.db, RateLimits.WAITLIST_SUBMIT, `ip:198.51.100.${ipCounter}`, RateLimits.WAITLIST_SUBMIT.limit - 1);
    await caller.submit({ ...application, email: "last-allowed@example.com" });

    await expect(caller.submit({ ...application, email: "onemore@example.com" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(await testDb.db.waitlist.findUnique({ where: { email: "onemore@example.com" } })).toBeNull();
  });
});
