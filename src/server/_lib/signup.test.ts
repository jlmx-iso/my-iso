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
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
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

      const statuses = [];
      for (let i = 0; i < limit + 1; i++) {
        const result = await signInWithOtp(
          testDb.db,
          { code: "000000", email: user.email },
          // A different address each time: only the per-email limit applies.
          `198.51.100.${i}`,
          inviteOnly,
        );
        statuses.push(result.status);
      }

      expect(statuses.slice(0, limit).every((status) => status === "rejected")).toBe(true);
      expect(statuses[limit]).toBe("rate_limited");

      // Even the right code is refused while limited.
      await issueOtp(testDb.db, user.email, { code: "123456" });
      await expect(
        signInWithOtp(testDb.db, { code: "123456", email: user.email }, IP, inviteOnly),
      ).resolves.toEqual({ status: "rate_limited" });
    });

    it("caps guesses per address per day, however many new codes are issued", async () => {
      const user = await createTestUser(testDb.db, { email: "ada@example.com" });
      const perWindow = RateLimits.OTP_VERIFY_EMAIL.limit;
      const perDay = RateLimits.OTP_VERIFY_EMAIL_DAILY.limit;

      let evaluated = 0;
      let ip = 0;
      // Guess as fast as the 15-minute limit allows, with a fresh code and a
      // fresh client address every time.
      for (let window = 0; evaluated < perDay; window++) {
        expect(window).toBeLessThan(10);
        for (let i = 0; i < perWindow && evaluated < perDay; i++) {
          await issueOtp(testDb.db, user.email, { code: "123456" });
          await expect(
            signInWithOtp(testDb.db, { code: "000000", email: user.email }, `198.51.100.${ip++}`, inviteOnly),
          ).resolves.toEqual({ status: "rejected" });
          evaluated += 1;
        }
        limiterClock.advance(RateLimits.OTP_VERIFY_EMAIL.windowSeconds);
      }

      // A new 15-minute window, a new code, a new client and the RIGHT code:
      // still refused, and distinguishably so.
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
        for (let i = 0; i < perDay; i++) {
          await signInWithOtp(testDb.db, { code: "000000", email }, `198.51.100.${i}`, inviteOnly);
          if ((i + 1) % RateLimits.OTP_VERIFY_EMAIL.limit === 0) {
            limiterClock.advance(RateLimits.OTP_VERIFY_EMAIL.windowSeconds);
          }
        }
        return signInWithOtp(testDb.db, { code: "000000", email }, "192.0.2.1", inviteOnly);
      };

      const member = await createTestUser(testDb.db, { email: "ada@example.com" });
      await expect(statusAfterCap(member.email)).resolves.toEqual({ status: "rate_limited" });
      await expect(statusAfterCap("nobody@example.com")).resolves.toEqual({ status: "rate_limited" });
    });

    it("does not let a client that is over its own limit use up someone's attempts", async () => {
      const victim = await createTestUser(testDb.db, { email: "victim@example.com" });
      const attackerIp = "198.51.100.200";

      // The attacker exhausts their own per-IP allowance on other addresses.
      for (let i = 0; i < RateLimits.OTP_VERIFY_IP.limit; i++) {
        await signInWithOtp(testDb.db, { code: "000000", email: `other${i}@example.com` }, attackerIp, inviteOnly);
      }
      const bucketsBefore = await testDb.raw.rateLimit.count();

      // ...and then hammers the victim's address.
      for (let i = 0; i < RateLimits.OTP_VERIFY_EMAIL_DAILY.limit + 5; i++) {
        await expect(
          signInWithOtp(testDb.db, { code: "000000", email: victim.email }, attackerIp, inviteOnly),
        ).resolves.toEqual({ status: "rate_limited" });
      }

      // No counter was opened for the victim's address,
      await expect(testDb.raw.rateLimit.count()).resolves.toBe(bucketsBefore);
      // and the victim signs in normally.
      await issueOtp(testDb.db, victim.email, { code: "123456" });
      await expect(
        signInWithOtp(testDb.db, { code: "123456", email: victim.email }, IP, inviteOnly),
      ).resolves.toMatchObject({ status: "ok" });
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
