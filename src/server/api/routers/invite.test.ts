import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimits } from "~/server/_utils/rateLimit";
import { USER_ROLES, WAITLIST_APPROVED_CODE } from "~/server/_utils/roles";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));

import { inviteRouter } from "./invite";

const CODE = "ISO-PENNY-AAAAAAAA";

describe("inviteRouter against SQLite", () => {
  let testDb: TestDb;
  let inviter: { email: string; id: string };

  const anonymous = (ip = "203.0.113.7") =>
    createDbCaller(inviteRouter, testDb.db, {
      headers: new Headers({ "cf-connecting-ip": ip }),
    });
  const as = (user: { email: string; id: string }) =>
    createDbCaller(inviteRouter, testDb.db, { user });

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    const { raw } = testDb;
    await raw.rateLimit.deleteMany();
    await raw.pendingInviteValidation.deleteMany();
    await raw.inviteRedemption.deleteMany();
    await raw.inviteCode.deleteMany();
    await raw.user.deleteMany();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    inviter = await createTestUser(testDb.db, { firstName: "Penny", lastName: "Lane" });
    await testDb.db.inviteCode.create({
      data: { code: CODE, creatorId: inviter.id, maxRedemptions: 2 },
    });
  });

  describe("validate", () => {
    it("reveals only the inviter's first name", async () => {
      const result = await anonymous().validate({ code: "iso-penny-aaaaaaaa " });

      expect(result).toEqual({ inviterName: "Penny", valid: true });
      expect(JSON.stringify(result)).not.toContain("Lane");
    });

    it("reports unknown and exhausted codes the same way", async () => {
      await testDb.db.inviteCode.update({
        data: { currentRedemptions: 2 },
        where: { code: CODE },
      });

      const exhausted = await anonymous().validate({ code: CODE });
      const unknown = await anonymous().validate({ code: "ISO-NOPE-AAAAAAAA" });

      expect(exhausted).toEqual({ inviterName: null, valid: false });
      expect(unknown).toEqual(exhausted);
    });

    it("is rate limited per IP so codes cannot be guessed in bulk", async () => {
      const limit = RateLimits.INVITE_VALIDATE.limit;
      for (let i = 0; i < limit; i++) {
        await anonymous().validate({ code: `ISO-GUESS-${String(i).padStart(8, "A")}` });
      }

      await expect(anonymous().validate({ code: CODE })).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
      // Another client is unaffected.
      await expect(anonymous("198.51.100.9").validate({ code: CODE })).resolves.toMatchObject({
        valid: true,
      });
    });
  });

  describe("prepareRegistration", () => {
    it("records which code an address intends to redeem, without reserving a slot", async () => {
      await anonymous().prepareRegistration({ code: CODE, email: "Nina@Example.com" });

      expect(await testDb.db.pendingInviteValidation.findMany()).toMatchObject([
        { code: CODE, email: "nina@example.com" },
      ]);
      await expect(
        testDb.db.inviteCode.findUniqueOrThrow({ where: { code: CODE } }),
      ).resolves.toMatchObject({ currentRedemptions: 0 });
    });

    it("rejects an unknown code", async () => {
      await expect(
        anonymous().prepareRegistration({ code: "ISO-NOPE-AAAAAAAA", email: "nina@example.com" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("does not let an anonymous caller overwrite a waitlist approval", async () => {
      const approvedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await testDb.db.pendingInviteValidation.create({
        data: { code: WAITLIST_APPROVED_CODE, email: "nina@example.com", expiresAt: approvedUntil },
      });

      await anonymous().prepareRegistration({ code: CODE, email: "nina@example.com" });

      expect(await testDb.db.pendingInviteValidation.findMany()).toMatchObject([
        { code: WAITLIST_APPROVED_CODE, expiresAt: approvedUntil },
      ]);
    });

    it("is rate limited per IP", async () => {
      const limit = RateLimits.INVITE_PREPARE.limit;
      for (let i = 0; i < limit; i++) {
        await anonymous().prepareRegistration({ code: CODE, email: `n${i}@example.com` });
      }
      await expect(
        anonymous().prepareRegistration({ code: CODE, email: "more@example.com" }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });
  });

  describe("redeem", () => {
    it("requires a session", async () => {
      await expect(anonymous().redeem({ code: CODE })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("redeems once: role, inviter link, slot", async () => {
      const user = await createTestUser(testDb.db);

      await as(user).redeem({ code: CODE });

      await expect(
        testDb.db.user.findUniqueOrThrow({ where: { id: user.id } }),
      ).resolves.toMatchObject({ invitedByUserId: inviter.id, role: USER_ROLES.FOUNDING_MEMBER });
      await expect(
        testDb.db.inviteCode.findUniqueOrThrow({ where: { code: CODE } }),
      ).resolves.toMatchObject({ currentRedemptions: 1 });
    });

    it("refuses a second redemption and gives the slot back", async () => {
      const user = await createTestUser(testDb.db);
      await as(user).redeem({ code: CODE });

      await expect(as(user).redeem({ code: CODE })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "You have already redeemed an invite code.",
      });
      await expect(
        testDb.db.inviteCode.findUniqueOrThrow({ where: { code: CODE } }),
      ).resolves.toMatchObject({ currentRedemptions: 1 });
    });

    it("counts one slot when the same user submits twice at once", async () => {
      const user = await createTestUser(testDb.db);

      const results = await Promise.allSettled([
        as(user).redeem({ code: CODE }),
        as(user).redeem({ code: CODE }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await expect(testDb.db.inviteRedemption.count()).resolves.toBe(1);
      await expect(
        testDb.db.inviteCode.findUniqueOrThrow({ where: { code: CODE } }),
      ).resolves.toMatchObject({ currentRedemptions: 1 });
    });

    it("refuses your own code and an exhausted code, without using a slot", async () => {
      await expect(as(inviter).redeem({ code: CODE })).rejects.toMatchObject({
        message: "You cannot use your own invite code.",
      });

      await testDb.db.inviteCode.update({ data: { currentRedemptions: 2 }, where: { code: CODE } });
      const user = await createTestUser(testDb.db);
      await expect(as(user).redeem({ code: CODE })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        testDb.db.inviteCode.findUniqueOrThrow({ where: { code: CODE } }),
      ).resolves.toMatchObject({ currentRedemptions: 2 });
    });

    it("does not demote a founder who redeems a code", async () => {
      const founder = await createTestUser(testDb.db, { role: USER_ROLES.FOUNDER });
      await as(founder).redeem({ code: CODE });
      await expect(
        testDb.db.user.findUniqueOrThrow({ where: { id: founder.id } }),
      ).resolves.toMatchObject({ role: USER_ROLES.FOUNDER });
    });
  });

  describe("getMyCode and regenerate", () => {
    it("creates the caller's code once, even for concurrent first visits", async () => {
      const user = await createTestUser(testDb.db, { firstName: "Nina" });

      const codes = await Promise.all([as(user).getMyCode(), as(user).getMyCode(), as(user).getMyCode()]);

      expect(new Set(codes.map((code) => code.code)).size).toBe(1);
      expect(codes[0]?.code).toMatch(/^ISO-NINA-[A-Z0-9]{8}$/);
      expect(codes[0]?.redemptions).toEqual([]);
    });

    it("regenerates to a new long code and keeps the redemption count", async () => {
      await testDb.db.inviteCode.update({ data: { currentRedemptions: 1 }, where: { code: CODE } });

      const updated = await as(inviter).regenerate();

      expect(updated.code).not.toBe(CODE);
      expect(updated.code).toMatch(/^ISO-PENNY-[A-Z0-9]{8}$/);
      expect(updated.currentRedemptions).toBe(1);
      await expect(anonymous().validate({ code: CODE })).resolves.toMatchObject({ valid: false });
    });
  });
});
