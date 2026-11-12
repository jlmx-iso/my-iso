import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { issueOtp, OTP_MAX_ATTEMPTS } from "~/server/_db/verificationToken";
import { verifyMobileToken } from "~/server/_utils/auth/mobileToken";
import { RateLimits } from "~/server/_utils/rateLimit";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

// ---------------------------------------------------------------------------
// Module mocks: only what needs a network or Auth.js. The database is real.
// ---------------------------------------------------------------------------

const mockSendEmail = vi.hoisted(() => vi.fn());

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/server/_lib/email", () => ({ sendEmail: mockSendEmail }));
vi.mock("~/server/_lib/emails", () => ({
  renderMobileOtpEmail: vi.fn(async ({ code }: { code: string }) => `<p>${code}</p>`),
}));

import { authRouter } from "./auth";

const EMAIL = "ada@example.com";

/** Lets the after-response email task run. */
const flushBackgroundTasks = () => new Promise((resolve) => setTimeout(resolve, 20));

// Limiter windows are slices of wall-clock time; see freezeRateLimitClock.
const limiterClock = freezeRateLimitClock();

describe("authRouter against SQLite", () => {
  let testDb: TestDb;
  let errorLog: MockInstance<typeof console.error>;

  const caller = (ip = "203.0.113.7") =>
    createDbCaller(authRouter, testDb.db, {
      headers: new Headers({ "cf-connecting-ip": ip }),
    });

  const tokens = () => testDb.raw.verificationToken.findMany();

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    const { raw } = testDb;
    await raw.rateLimit.deleteMany();
    await raw.verificationToken.deleteMany();
    await raw.pendingInviteValidation.deleteMany();
    await raw.user.deleteMany();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue({ isErr: false, isOk: true, value: { success: true } });
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("no longer exposes account registration or link verification", () => {
    expect(Object.keys(authRouter._def.procedures).sort()).toEqual([
      "exchangeMobileToken",
      "requestMobileOtp",
      "verifyMobileOtp",
    ]);
  });

  describe("requestMobileOtp", () => {
    it("stores a code for an existing user and emails it", async () => {
      await createTestUser(testDb.db, { email: EMAIL });

      const result = await caller().requestMobileOtp({ email: "Ada@Example.com" });
      await flushBackgroundTasks();

      expect(result).toEqual({ devCode: undefined, sent: true });
      const [token] = await tokens();
      expect(token).toMatchObject({ attempts: 0, identifier: `otp:${EMAIL}` });
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ email: EMAIL, html: `<p>${token?.token}</p>` }),
      );
    });

    it("stores a code for an invitee who has no account yet", async () => {
      await testDb.db.pendingInviteValidation.create({
        data: { code: "ISO-X-AAAAAAAA", email: EMAIL, expiresAt: new Date(Date.now() + 60_000) },
      });

      await caller().requestMobileOtp({ email: EMAIL });

      await expect(tokens()).resolves.toHaveLength(1);
    });

    it("answers identically, and sends nothing, for an unknown address", async () => {
      const known = await createTestUser(testDb.db, { email: EMAIL });

      const forKnown = await caller().requestMobileOtp({ email: known.email });
      const forUnknown = await caller().requestMobileOtp({ email: "nobody@example.com" });
      await flushBackgroundTasks();

      expect(forUnknown).toEqual(forKnown);
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect((await tokens()).map((t) => t.identifier)).toEqual([`otp:${EMAIL}`]);
    });

    it("answers identically when the email cannot be sent", async () => {
      await createTestUser(testDb.db, { email: EMAIL });
      mockSendEmail.mockResolvedValue({
        error: new Error("provider down"),
        isErr: true,
        isOk: false,
      });

      const result = await caller().requestMobileOtp({ email: EMAIL });
      await flushBackgroundTasks();

      // Same reply as for an address that does not exist: the failure is
      // logged, not reported to the (unauthenticated) caller.
      expect(result).toEqual({ devCode: undefined, sent: true });
      expect(errorLog).toHaveBeenCalled();
    });

    it("never logs the email address or the code", async () => {
      await createTestUser(testDb.db, { email: EMAIL });
      const infoLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
      mockSendEmail.mockResolvedValue({ error: new Error("down"), isErr: true, isOk: false });

      await caller().requestMobileOtp({ email: EMAIL });
      await flushBackgroundTasks();

      const [token] = await tokens();
      const logged = JSON.stringify([...infoLog.mock.calls, ...errorLog.mock.calls]);
      expect(logged).not.toContain(EMAIL);
      expect(logged).not.toContain("a***@");
      expect(logged).not.toContain(token?.token);
    });

    it("limits requests per email address, whatever the IP", async () => {
      await createTestUser(testDb.db, { email: EMAIL });
      const limit = RateLimits.OTP_REQUEST_EMAIL.limit;

      for (let i = 0; i < limit; i++) {
        await caller(`198.51.100.${i}`).requestMobileOtp({ email: EMAIL });
      }

      await expect(
        caller("198.51.100.200").requestMobileOtp({ email: EMAIL }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });

    it("limits requests per IP address, whatever the email", async () => {
      const limit = RateLimits.OTP_REQUEST_IP.limit;

      for (let i = 0; i < limit; i++) {
        await caller().requestMobileOtp({ email: `user${i}@example.com` });
      }

      await expect(
        caller().requestMobileOtp({ email: "one-more@example.com" }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });

    it("does not let X-Forwarded-For choose the rate-limit bucket", async () => {
      const limit = RateLimits.OTP_REQUEST_IP.limit;
      const spoofing = (i: number) =>
        createDbCaller(authRouter, testDb.db, {
          headers: new Headers({
            "cf-connecting-ip": "203.0.113.50",
            "x-forwarded-for": `10.0.0.${i}`,
          }),
        });

      for (let i = 0; i < limit; i++) {
        await spoofing(i).requestMobileOtp({ email: `user${i}@example.com` });
      }

      await expect(
        spoofing(250).requestMobileOtp({ email: "one-more@example.com" }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });

    it("caps codes requested for one address per day", async () => {
      await createTestUser(testDb.db, { email: EMAIL });
      const perWindow = RateLimits.OTP_REQUEST_EMAIL.limit;
      const perDay = RateLimits.OTP_REQUEST_EMAIL_DAILY.limit;

      for (let sent = 0; sent < perDay; sent++) {
        if (sent > 0 && sent % perWindow === 0) {
          limiterClock.advance(RateLimits.OTP_REQUEST_EMAIL.windowSeconds);
        }
        await caller(`198.51.100.${sent}`).requestMobileOtp({ email: EMAIL });
      }
      limiterClock.advance(RateLimits.OTP_REQUEST_EMAIL.windowSeconds);

      await expect(
        caller("192.0.2.1").requestMobileOtp({ email: EMAIL }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      // The same answer for an address with no account.
      for (let sent = 0; sent < perDay; sent++) {
        if (sent > 0 && sent % perWindow === 0) {
          limiterClock.advance(RateLimits.OTP_REQUEST_EMAIL.windowSeconds);
        }
        await caller(`198.51.100.${sent}`).requestMobileOtp({ email: "nobody@example.com" });
      }
      limiterClock.advance(RateLimits.OTP_REQUEST_EMAIL.windowSeconds);
      await expect(
        caller("192.0.2.1").requestMobileOtp({ email: "nobody@example.com" }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

      limiterClock.advance(RateLimits.OTP_REQUEST_EMAIL_DAILY.windowSeconds);
      await expect(caller("192.0.2.1").requestMobileOtp({ email: EMAIL })).resolves.toMatchObject({
        sent: true,
      });
    });

    it("does not count a request against the address once the client is over its own limit", async () => {
      const blockedIp = "198.51.100.200";
      for (let i = 0; i < RateLimits.OTP_REQUEST_IP.limit; i++) {
        await caller(blockedIp).requestMobileOtp({ email: `user${i}@example.com` });
      }
      const bucketsBefore = await testDb.raw.rateLimit.count();

      for (let i = 0; i < RateLimits.OTP_REQUEST_EMAIL.limit + 1; i++) {
        await expect(
          caller(blockedIp).requestMobileOtp({ email: EMAIL }),
        ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      }

      await expect(testDb.raw.rateLimit.count()).resolves.toBe(bucketsBefore);
      await expect(caller().requestMobileOtp({ email: EMAIL })).resolves.toMatchObject({ sent: true });
    });

    it("fails closed when the rate limiter is unavailable", async () => {
      await createTestUser(testDb.db, { email: EMAIL });
      const withoutLimiter = Object.create(testDb.db, {
        $queryRaw: {
          value: () => {
            throw new Error("database unavailable");
          },
        },
      }) as TestDb["db"];

      await expect(
        createDbCaller(authRouter, withoutLimiter).requestMobileOtp({ email: EMAIL }),
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      await expect(tokens()).resolves.toHaveLength(0);
    });
  });

  describe("verifyMobileOtp", () => {
    it("returns a mobile token for the right code and consumes the code", async () => {
      const user = await createTestUser(testDb.db, { email: EMAIL });
      await issueOtp(testDb.db, EMAIL, { code: "123456" });

      const result = await caller().verifyMobileOtp({ code: "123456", email: EMAIL });

      expect(result.userId).toBe(user.id);
      await expect(verifyMobileToken(result.token)).resolves.toMatchObject({ userId: user.id });
      await expect(tokens()).resolves.toHaveLength(0);
    });

    it("gives the same error for a wrong code and for an unknown account", async () => {
      await createTestUser(testDb.db, { email: EMAIL });
      await issueOtp(testDb.db, EMAIL, { code: "123456" });
      // A code exists for this address (pending invite), but no account.
      await issueOtp(testDb.db, "invitee@example.com", { code: "123456" });

      const wrongCode = await caller()
        .verifyMobileOtp({ code: "000000", email: EMAIL })
        .catch((e: unknown) => e);
      const noAccount = await caller()
        .verifyMobileOtp({ code: "123456", email: "invitee@example.com" })
        .catch((e: unknown) => e);
      const noCodeAtAll = await caller()
        .verifyMobileOtp({ code: "123456", email: "nobody@example.com" })
        .catch((e: unknown) => e);

      for (const error of [wrongCode, noAccount, noCodeAtAll]) {
        expect(error).toMatchObject({ code: "UNAUTHORIZED", message: "Invalid or expired code." });
      }
    });

    it("rejects codes that are not six digits before touching the database", async () => {
      await issueOtp(testDb.db, EMAIL, { code: "123456" });
      await expect(
        caller().verifyMobileOtp({ code: "12345x", email: EMAIL }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await tokens()).toMatchObject([{ attempts: 0 }]);
    });

    it(`locks the code after ${OTP_MAX_ATTEMPTS} wrong attempts`, async () => {
      await createTestUser(testDb.db, { email: EMAIL });
      await issueOtp(testDb.db, EMAIL, { code: "123456" });

      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        await expect(
          caller().verifyMobileOtp({ code: `00000${i}`, email: EMAIL }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      }

      await expect(
        caller().verifyMobileOtp({ code: "123456", email: EMAIL }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("answers TOO_MANY_REQUESTS, not UNAUTHORIZED, once the daily cap for the address is reached", async () => {
      await createTestUser(testDb.db, { email: EMAIL });
      const perWindow = RateLimits.OTP_VERIFY_EMAIL.limit;
      const perDay = RateLimits.OTP_VERIFY_EMAIL_DAILY.limit;

      for (let guess = 0; guess < perDay; guess++) {
        if (guess > 0 && guess % perWindow === 0) {
          limiterClock.advance(RateLimits.OTP_VERIFY_EMAIL.windowSeconds);
        }
        await issueOtp(testDb.db, EMAIL, { code: "123456" });
        await expect(
          caller(`198.51.100.${guess}`).verifyMobileOtp({ code: "000000", email: EMAIL }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      }
      limiterClock.advance(RateLimits.OTP_VERIFY_EMAIL.windowSeconds);

      await issueOtp(testDb.db, EMAIL, { code: "123456" });
      await expect(
        caller("192.0.2.1").verifyMobileOtp({ code: "123456", email: EMAIL }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      // The refused attempt did not touch the code.
      expect(await tokens()).toMatchObject([{ attempts: 0 }]);
    });

    it("cannot be brute-forced by sending many guesses at once", async () => {
      await createTestUser(testDb.db, { email: EMAIL });
      await issueOtp(testDb.db, EMAIL, { code: "123456" });

      const guesses = [...Array.from({ length: 40 }, (_, i) => String(i).padStart(6, "0")), "123456"];
      const results = await Promise.allSettled(
        guesses.map((code, i) =>
          caller(`198.51.100.${i}`).verifyMobileOtp({ code, email: EMAIL }),
        ),
      );

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(0);
    });
  });
});
