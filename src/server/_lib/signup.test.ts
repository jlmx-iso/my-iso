import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimInviteSlot,
  ensureInviteCode,
  isInviteRedeemable,
  releaseInviteSlot,
} from "~/server/_db/invite";
import { issueOtp } from "~/server/_db/verificationToken";
import { generateInviteCode, INVITE_CODE_ALPHABET } from "~/server/_utils/invite";
import { RateLimits } from "~/server/_utils/rateLimit";
import { USER_ROLES, WAITLIST_APPROVED_CODE } from "~/server/_utils/roles";
import { freezeRateLimitClock, spendOtpVerifyLimit } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import { createInvitedUser, signInWithOtp } from "./signup";

const inviteOnly = async () => true;
const openRegistration = async () => false;

const IP = "203.0.113.7";

// Limiter windows are slices of wall-clock time; see freezeRateLimitClock.
const limiterClock = freezeRateLimitClock();

describe("invite codes", () => {
  it("have an 8-character random part from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode("Penny Lane");
      const match = /^ISO-PENNY-([A-Z0-9]{8})$/.exec(code);
      expect(match).not.toBeNull();
      for (const char of match?.[1] ?? "") {
        expect(INVITE_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("pads short names and strips punctuation", () => {
    expect(generateInviteCode("Al")).toMatch(/^ISO-ALX-/);
    expect(generateInviteCode("")).toMatch(/^ISO-XXX-/);
    expect(generateInviteCode("d'Arcy")).toMatch(/^ISO-DARCY-/);
  });
});

describe("invite redemption against SQLite", () => {
  let testDb: TestDb;
  let inviterId: string;

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
    await raw.inviteRedemption.deleteMany();
    await raw.inviteCode.deleteMany();
    await raw.user.deleteMany();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    inviterId = (await createTestUser(testDb.db, { firstName: "Penny" })).id;
  });

  async function createInvite(code: string, maxRedemptions: number, currentRedemptions = 0) {
    return testDb.db.inviteCode.create({
      data: { code, creatorId: inviterId, currentRedemptions, maxRedemptions },
    });
  }

  async function prepare(email: string, code: string, minutes = 5) {
    await testDb.db.pendingInviteValidation.create({
      data: { code, email, expiresAt: new Date(Date.now() + minutes * 60_000) },
    });
  }

  const profile = (email: string) => ({
    email,
    emailVerified: new Date(),
    firstName: "Nina",
    lastName: "New",
  });

  const invite = (code: string) =>
    testDb.db.inviteCode.findUniqueOrThrow({ where: { code } });

  describe("claimInviteSlot", () => {
    it("takes a slot while one is left and none after", async () => {
      await createInvite("ISO-PENNY-AAAAAAAA", 2);

      await expect(claimInviteSlot(testDb.db, "iso-penny-aaaaaaaa")).resolves.toMatchObject({
        creatorId: inviterId,
      });
      await expect(claimInviteSlot(testDb.db, "ISO-PENNY-AAAAAAAA")).resolves.not.toBeNull();
      await expect(claimInviteSlot(testDb.db, "ISO-PENNY-AAAAAAAA")).resolves.toBeNull();
      expect((await invite("ISO-PENNY-AAAAAAAA")).currentRedemptions).toBe(2);
    });

    it("returns null for an unknown code", async () => {
      await expect(claimInviteSlot(testDb.db, "ISO-NOPE-AAAAAAAA")).resolves.toBeNull();
    });

    it("gives the last slot to exactly one of many concurrent claims", async () => {
      await createInvite("ISO-PENNY-AAAAAAAA", 5, 4);

      const claims = await Promise.all(
        Array.from({ length: 20 }, () => claimInviteSlot(testDb.db, "ISO-PENNY-AAAAAAAA")),
      );

      expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
      expect((await invite("ISO-PENNY-AAAAAAAA")).currentRedemptions).toBe(5);
    });

    it("can be released, and never below zero", async () => {
      const created = await createInvite("ISO-PENNY-AAAAAAAA", 1);
      await claimInviteSlot(testDb.db, created.code);

      await releaseInviteSlot(testDb.db, created.id);
      await releaseInviteSlot(testDb.db, created.id);

      expect((await invite(created.code)).currentRedemptions).toBe(0);
      await expect(isInviteRedeemable(testDb.db, created.code)).resolves.toBe(true);
    });
  });

  describe("ensureInviteCode", () => {
    it("creates one code per user even when called concurrently", async () => {
      const user = await createTestUser(testDb.db, { firstName: "Nina" });

      const codes = await Promise.all(
        Array.from({ length: 5 }, () => ensureInviteCode(testDb.db, user.id, "Nina")),
      );

      expect(new Set(codes.map((code) => code.id)).size).toBe(1);
      await expect(
        testDb.db.inviteCode.count({ where: { creatorId: user.id } }),
      ).resolves.toBe(1);
    });
  });

  describe("createInvitedUser", () => {
    it("admits an invitee: role, inviter link, redemption, own code, slot counted", async () => {
      await createInvite("ISO-PENNY-AAAAAAAA", 5);
      await prepare("nina@example.com", "ISO-PENNY-AAAAAAAA");

      const user = await createInvitedUser(testDb.db, profile("nina@example.com"), inviteOnly);

      expect(user).toMatchObject({
        email: "nina@example.com",
        invitedByUserId: inviterId,
        role: USER_ROLES.FOUNDING_MEMBER,
      });
      expect((await invite("ISO-PENNY-AAAAAAAA")).currentRedemptions).toBe(1);
      await expect(
        testDb.db.inviteRedemption.findMany({ where: { redeemedById: user?.id } }),
      ).resolves.toHaveLength(1);
      await expect(
        testDb.db.inviteCode.findUnique({ where: { creatorId: user?.id } }),
      ).resolves.toMatchObject({ code: expect.stringMatching(/^ISO-NINA-[A-Z0-9]{8}$/) as string });
      await expect(testDb.db.pendingInviteValidation.count()).resolves.toBe(0);
    });

    it("refuses sign-up without a pending invite and creates nothing", async () => {
      const user = await createInvitedUser(testDb.db, profile("nina@example.com"), inviteOnly);

      expect(user).toBeNull();
      await expect(
        testDb.db.user.findUnique({ where: { email: "nina@example.com" } }),
      ).resolves.toBeNull();
    });

    it("refuses sign-up when the invite is full, and grants no role", async () => {
      await createInvite("ISO-PENNY-AAAAAAAA", 5, 5);
      await prepare("nina@example.com", "ISO-PENNY-AAAAAAAA");

      const user = await createInvitedUser(testDb.db, profile("nina@example.com"), inviteOnly);

      expect(user).toBeNull();
      await expect(testDb.db.user.count()).resolves.toBe(1); // the inviter only
      expect((await invite("ISO-PENNY-AAAAAAAA")).currentRedemptions).toBe(5);
      await expect(testDb.db.pendingInviteValidation.count()).resolves.toBe(0);
    });

    it("refuses sign-up when the invite code no longer exists", async () => {
      await prepare("nina@example.com", "ISO-GONE-AAAAAAAA");

      await expect(
        createInvitedUser(testDb.db, profile("nina@example.com"), inviteOnly),
      ).resolves.toBeNull();
      await expect(testDb.db.user.count()).resolves.toBe(1);
    });

    it("ignores an expired pending invite", async () => {
      await createInvite("ISO-PENNY-AAAAAAAA", 5);
      await prepare("nina@example.com", "ISO-PENNY-AAAAAAAA", -1);

      await expect(
        createInvitedUser(testDb.db, profile("nina@example.com"), inviteOnly),
      ).resolves.toBeNull();
      expect((await invite("ISO-PENNY-AAAAAAAA")).currentRedemptions).toBe(0);
    });

    it("admits exactly one of two concurrent sign-ups for the last slot", async () => {
      await createInvite("ISO-PENNY-AAAAAAAA", 1);
      await prepare("a@example.com", "ISO-PENNY-AAAAAAAA");
      await prepare("b@example.com", "ISO-PENNY-AAAAAAAA");

      const results = await Promise.all([
        createInvitedUser(testDb.db, profile("a@example.com"), inviteOnly),
        createInvitedUser(testDb.db, profile("b@example.com"), inviteOnly),
      ]);

      expect(results.filter((user) => user !== null)).toHaveLength(1);
      expect((await invite("ISO-PENNY-AAAAAAAA")).currentRedemptions).toBe(1);
      await expect(testDb.db.inviteRedemption.count()).resolves.toBe(1);
      await expect(
        testDb.db.user.count({ where: { role: USER_ROLES.FOUNDING_MEMBER } }),
      ).resolves.toBe(1);
      // Inviter + the one admitted invitee.
      await expect(testDb.db.user.count()).resolves.toBe(2);
    });

    it("never exceeds capacity under a larger concurrent burst", async () => {
      await createInvite("ISO-PENNY-AAAAAAAA", 3);
      const emails = Array.from({ length: 12 }, (_, i) => `burst${i}@example.com`);
      for (const email of emails) await prepare(email, "ISO-PENNY-AAAAAAAA");

      const results = await Promise.all(
        emails.map((email) => createInvitedUser(testDb.db, profile(email), inviteOnly)),
      );

      expect(results.filter((user) => user !== null)).toHaveLength(3);
      expect((await invite("ISO-PENNY-AAAAAAAA")).currentRedemptions).toBe(3);
      await expect(testDb.db.inviteRedemption.count()).resolves.toBe(3);
    });

    it("gives the slot back when the account cannot be created", async () => {
      await createInvite("ISO-PENNY-AAAAAAAA", 1);
      const taken = await createTestUser(testDb.db, { email: "taken@example.com" });
      await prepare(taken.email, "ISO-PENNY-AAAAAAAA");

      // The address already has an account: the insert violates User.email.
      await expect(
        createInvitedUser(testDb.db, profile(taken.email), inviteOnly),
      ).rejects.toThrow();

      expect((await invite("ISO-PENNY-AAAAAAAA")).currentRedemptions).toBe(0);
      await expect(testDb.db.inviteRedemption.count()).resolves.toBe(0);
    });

    it("admits a waitlist-approved address without using an invite slot", async () => {
      await prepare("nina@example.com", WAITLIST_APPROVED_CODE, 60);

      const user = await createInvitedUser(testDb.db, profile("nina@example.com"), inviteOnly);

      expect(user).toMatchObject({ invitedByUserId: null, role: USER_ROLES.FOUNDING_MEMBER });
      await expect(testDb.db.inviteRedemption.count()).resolves.toBe(0);
      await expect(testDb.db.pendingInviteValidation.count()).resolves.toBe(0);
    });

    it("creates a standard member without an invite when registration is open", async () => {
      const user = await createInvitedUser(
        testDb.db,
        profile("nina@example.com"),
        openRegistration,
      );
      expect(user).toMatchObject({ role: USER_ROLES.STANDARD });
    });
  });

  describe("signInWithOtp", () => {
    it("signs an existing user in with the right code", async () => {
      const user = await createTestUser(testDb.db, { email: "ada@example.com" });
      await issueOtp(testDb.db, user.email, { code: "123456" });

      const result = await signInWithOtp(
        testDb.db,
        { code: "123456", email: "Ada@Example.com" },
        IP,
        inviteOnly,
      );

      expect(result).toMatchObject({ status: "ok", user: { id: user.id } });
    });

    it("rejects malformed credentials without touching the code", async () => {
      await issueOtp(testDb.db, "ada@example.com", { code: "123456" });

      for (const credentials of [
        null,
        {},
        { code: "12345", email: "ada@example.com" },
        { code: "12345a", email: "ada@example.com" },
        { code: "123456", email: "not-an-email" },
        { code: ["123456"], email: "ada@example.com" },
      ]) {
        await expect(signInWithOtp(testDb.db, credentials, IP, inviteOnly)).resolves.toEqual({
          status: "rejected",
        });
      }
      expect(await testDb.raw.verificationToken.findMany()).toMatchObject([{ attempts: 0 }]);
    });

    it("locks the code after five wrong attempts", async () => {
      const user = await createTestUser(testDb.db, { email: "ada@example.com" });
      await issueOtp(testDb.db, user.email, { code: "123456" });

      for (let i = 0; i < 5; i++) {
        await expect(
          signInWithOtp(testDb.db, { code: `00000${i}`, email: user.email }, IP, inviteOnly),
        ).resolves.toEqual({ status: "rejected" });
      }
      await expect(
        signInWithOtp(testDb.db, { code: "123456", email: user.email }, IP, inviteOnly),
      ).resolves.toEqual({ status: "rejected" });
    });

    it("rate limits verification per email address", async () => {
      const user = await createTestUser(testDb.db, { email: "ada@example.com" });
      const limit = RateLimits.OTP_VERIFY_EMAIL.limit;
      // Guesses from many other clients have all but used up the window.
      await spendOtpVerifyLimit(testDb.db, RateLimits.OTP_VERIFY_EMAIL, IP, user.email, limit - 2);

      const statuses = [];
      for (let i = 0; i < 3; i++) {
        const result = await signInWithOtp(
          testDb.db,
          { code: "000000", email: user.email },
          // A different address each time: only the per-email limit applies.
          `198.51.100.${i}`,
          inviteOnly,
        );
        statuses.push(result.status);
      }

      expect(statuses).toEqual(["rejected", "rejected", "rate_limited"]);

      // Even the right code is refused while limited.
      await issueOtp(testDb.db, user.email, { code: "123456" });
      await expect(
        signInWithOtp(testDb.db, { code: "123456", email: user.email }, IP, inviteOnly),
      ).resolves.toEqual({ status: "rate_limited" });
    });

    it("caps guesses per address per day, however many new codes are issued", async () => {
      const user = await createTestUser(testDb.db, { email: "ada@example.com" });
      const perDay = RateLimits.OTP_VERIFY_EMAIL_DAILY.limit;
      // Earlier in the day, in earlier 15-minute windows, all but two of the
      // day's guesses were made (by any number of clients).
      await spendOtpVerifyLimit(testDb.db, RateLimits.OTP_VERIFY_EMAIL_DAILY, IP, user.email, perDay - 2);

      // The last two, each with a fresh code and a fresh client, are still
      // looked at (and counted).
      for (const ip of ["198.51.100.1", "198.51.100.2"]) {
        await issueOtp(testDb.db, user.email, { code: "123456" });
        await expect(
          signInWithOtp(testDb.db, { code: "000000", email: user.email }, ip, inviteOnly),
        ).resolves.toEqual({ status: "rejected" });
      }

      // A new 15-minute window, a new code, a new client and the RIGHT code:
      // still refused, and distinguishably so.
      limiterClock.advance(RateLimits.OTP_VERIFY_EMAIL.windowSeconds);
      await issueOtp(testDb.db, user.email, { code: "123456" });
      await expect(
        signInWithOtp(testDb.db, { code: "123456", email: user.email }, "192.0.2.1", inviteOnly),
      ).resolves.toEqual({ status: "rate_limited" });

      // The next day the address can sign in again.
      limiterClock.advance(RateLimits.OTP_VERIFY_EMAIL_DAILY.windowSeconds);
      await expect(
        signInWithOtp(testDb.db, { code: "123456", email: user.email }, "192.0.2.1", inviteOnly),
      ).resolves.toMatchObject({ status: "ok" });
    });

    it("answers a daily-capped address the same whether or not it has an account", async () => {
      const perDay = RateLimits.OTP_VERIFY_EMAIL_DAILY.limit;
      const statusAfterCap = async (email: string) => {
        await spendOtpVerifyLimit(testDb.db, RateLimits.OTP_VERIFY_EMAIL_DAILY, IP, email, perDay);
        return signInWithOtp(testDb.db, { code: "000000", email }, "192.0.2.1", inviteOnly);
      };

      const member = await createTestUser(testDb.db, { email: "ada@example.com" });
      await expect(statusAfterCap(member.email)).resolves.toEqual({ status: "rate_limited" });
      await expect(statusAfterCap("nobody@example.com")).resolves.toEqual({ status: "rate_limited" });
    });

    it("does not let a client that is over its own limit use up someone's attempts", async () => {
      const victim = await createTestUser(testDb.db, { email: "victim@example.com" });
      const attackerIp = "198.51.100.200";

      // The attacker has used all but one of their per-IP allowance on other
      // addresses; the next guess (really made) uses the last of it.
      await spendOtpVerifyLimit(
        testDb.db,
        RateLimits.OTP_VERIFY_IP,
        attackerIp,
        "other@example.com",
        RateLimits.OTP_VERIFY_IP.limit - 1,
      );
      await expect(
        signInWithOtp(testDb.db, { code: "000000", email: "other@example.com" }, attackerIp, inviteOnly),
      ).resolves.toEqual({ status: "rejected" });
      const countersBefore = await testDb.raw.rateLimit.findMany({ orderBy: { key: "asc" } });

      // ...and then hammers the victim's address.
      for (let i = 0; i < 5; i++) {
        await expect(
          signInWithOtp(testDb.db, { code: "000000", email: victim.email }, attackerIp, inviteOnly),
        ).resolves.toEqual({ status: "rate_limited" });
      }

      // Only the attacker's own per-IP counter moved: no counter was opened
      // or touched for the victim's address,
      const countersAfter = await testDb.raw.rateLimit.findMany({ orderBy: { key: "asc" } });
      expect(countersAfter.map(({ count: _count, ...row }) => row)).toEqual(
        countersBefore.map(({ count: _count, ...row }) => row),
      );
      expect(countersAfter.filter((row, i) => row.count !== countersBefore[i]?.count).map((row) => row.key)).toEqual([
        expect.stringMatching(/^otp-verify-ip:/),
      ]);
      // and the victim signs in normally.
      await issueOtp(testDb.db, victim.email, { code: "123456" });
      await expect(
        signInWithOtp(testDb.db, { code: "123456", email: victim.email }, IP, inviteOnly),
      ).resolves.toMatchObject({ status: "ok" });
    });

    it("one client cannot use up an address's daily allowance and lock its owner out", async () => {
      const victim = await createTestUser(testDb.db, { email: "victim@example.com" });
      const attackerIp = "198.51.100.200";
      const perClientDay = RateLimits.OTP_VERIFY_EMAIL_IP_DAILY.limit;
      // One client's daily allowance against an address is well short of the
      // ceiling that client shares with the address's owner.
      expect(perClientDay).toBeLessThan(RateLimits.OTP_VERIFY_EMAIL_DAILY.limit);

      // The attacker has guessed at the victim's address all day: every
      // guess counted for the pair (attacker, address) and for the address.
      await spendOtpVerifyLimit(testDb.db, RateLimits.OTP_VERIFY_EMAIL_IP_DAILY, attackerIp, victim.email, perClientDay - 1);
      await spendOtpVerifyLimit(testDb.db, RateLimits.OTP_VERIFY_EMAIL_DAILY, attackerIp, victim.email, perClientDay - 1);

      // Their last allowed guess is looked at; every one after it is refused,
      const statuses: string[] = [];
      for (let i = 0; i < 4; i++) {
        const result = await signInWithOtp(testDb.db, { code: "000000", email: victim.email }, attackerIp, inviteOnly);
        statuses.push(result.status);
      }
      expect(statuses).toEqual(["rejected", "rate_limited", "rate_limited", "rate_limited"]);

      // in later 15-minute windows too,
      limiterClock.advance(RateLimits.OTP_VERIFY_EMAIL.windowSeconds);
      await expect(
        signInWithOtp(testDb.db, { code: "000000", email: victim.email }, attackerIp, inviteOnly),
      ).resolves.toEqual({ status: "rate_limited" });

      // and the refused guesses did not count against the address: it stands
      // at the attacker's allowance, not more.
      const addressWide = await testDb.raw.rateLimit.findMany({
        where: { key: { startsWith: "otp-verify-email-daily:" } },
      });
      expect(addressWide).toMatchObject([{ count: perClientDay }]);

      // So the victim, on their own connection, still signs in the same day.
      await issueOtp(testDb.db, victim.email, { code: "123456" });
      await expect(
        signInWithOtp(testDb.db, { code: "123456", email: victim.email }, IP, inviteOnly),
      ).resolves.toMatchObject({ status: "ok" });
    });

    it("limits one client's guesses against one address per 15 minutes without touching the shared counters further", async () => {
      const victim = await createTestUser(testDb.db, { email: "victim@example.com" });
      const attackerIp = "198.51.100.201";
      const limit = RateLimits.OTP_VERIFY_EMAIL_IP.limit;
      await spendOtpVerifyLimit(testDb.db, RateLimits.OTP_VERIFY_EMAIL_IP, attackerIp, victim.email, limit - 1);

      // The last guess of the window goes through to the code check...
      await expect(
        signInWithOtp(testDb.db, { code: "000000", email: victim.email }, attackerIp, inviteOnly),
      ).resolves.toEqual({ status: "rejected" });
      const sharedBefore = await testDb.raw.rateLimit.findMany({
        where: { key: { startsWith: "otp-verify-email:" } },
      });
      // ...and the ones after it are refused on the client's own limit.
      for (let i = 0; i < 3; i++) {
        await expect(
          signInWithOtp(testDb.db, { code: "000000", email: victim.email }, attackerIp, inviteOnly),
        ).resolves.toEqual({ status: "rate_limited" });
      }

      // The address-wide counter did not move.
      expect(sharedBefore).toMatchObject([{ count: 1 }]);
      await expect(
        testDb.raw.rateLimit.findMany({ where: { key: { startsWith: "otp-verify-email:" } } }),
      ).resolves.toEqual(sharedBefore);
    });

    it("fails closed when the rate limiter cannot be reached", async () => {
      const user = await createTestUser(testDb.db, { email: "ada@example.com" });
      await issueOtp(testDb.db, user.email, { code: "123456" });

      const withoutLimiter = Object.create(testDb.db, {
        $queryRaw: {
          value: () => {
            throw new Error("database unavailable");
          },
        },
      }) as TestDb["db"];

      await expect(
        signInWithOtp(withoutLimiter, { code: "123456", email: user.email }, IP, inviteOnly),
      ).resolves.toEqual({ status: "rate_limited" });
    });

    it("creates the invitee's account on their first valid code", async () => {
      await createInvite("ISO-PENNY-AAAAAAAA", 1);
      await prepare("nina@example.com", "ISO-PENNY-AAAAAAAA");
      await issueOtp(testDb.db, "nina@example.com", { code: "123456" });

      const result = await signInWithOtp(
        testDb.db,
        { code: "123456", email: "nina@example.com" },
        IP,
        inviteOnly,
      );

      expect(result).toMatchObject({
        status: "ok",
        user: { invitedByUserId: inviterId, role: USER_ROLES.FOUNDING_MEMBER },
      });
    });

    it("admits exactly one of two concurrent invitees competing for one slot", async () => {
      await createInvite("ISO-PENNY-AAAAAAAA", 1);
      for (const email of ["a@example.com", "b@example.com"]) {
        await prepare(email, "ISO-PENNY-AAAAAAAA");
        await issueOtp(testDb.db, email, { code: "123456" });
      }

      const results = await Promise.all([
        signInWithOtp(testDb.db, { code: "123456", email: "a@example.com" }, "198.51.100.1", inviteOnly),
        signInWithOtp(testDb.db, { code: "123456", email: "b@example.com" }, "198.51.100.2", inviteOnly),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(["ok", "rejected"]);
      expect((await invite("ISO-PENNY-AAAAAAAA")).currentRedemptions).toBe(1);
      await expect(testDb.db.user.count()).resolves.toBe(2);
    });

    it("does not create an account for a valid code without an invite", async () => {
      await issueOtp(testDb.db, "nina@example.com", { code: "123456" });

      await expect(
        signInWithOtp(testDb.db, { code: "123456", email: "nina@example.com" }, IP, inviteOnly),
      ).resolves.toEqual({ status: "rejected" });
      await expect(testDb.db.user.count()).resolves.toBe(1);
    });
  });
});
