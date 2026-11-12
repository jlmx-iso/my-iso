import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "~/test/helpers/sqlite";

import {
  issueOtp,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  otpIdentifier,
  verifyOtp,
} from "./verificationToken";

const EMAIL = "ada@example.com";
const CODE = "123456";

describe("email sign-in codes against SQLite", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.raw.verificationToken.deleteMany();
  });

  const tokens = () => testDb.raw.verificationToken.findMany();

  it("accepts the right code once and consumes it", async () => {
    await issueOtp(testDb.db, EMAIL, { code: CODE });

    await expect(verifyOtp(testDb.db, EMAIL, CODE)).resolves.toBe(true);
    await expect(tokens()).resolves.toHaveLength(0);
    await expect(verifyOtp(testDb.db, EMAIL, CODE)).resolves.toBe(false);
  });

  it("generates a 6-digit code and stores it under the email's identifier", async () => {
    const code = await issueOtp(testDb.db, "  Ada@Example.com ");
    expect(code).toMatch(/^\d{6}$/);
    expect(await tokens()).toMatchObject([
      { attempts: 0, identifier: otpIdentifier(EMAIL), token: code },
    ]);
  });

  it("replaces the previous code when a new one is issued", async () => {
    await issueOtp(testDb.db, EMAIL, { code: "111111" });
    await issueOtp(testDb.db, EMAIL, { code: "222222" });

    await expect(verifyOtp(testDb.db, EMAIL, "111111")).resolves.toBe(false);
    await expect(verifyOtp(testDb.db, EMAIL, "222222")).resolves.toBe(true);
  });

  it("lets two users hold the same 6-digit value", async () => {
    await issueOtp(testDb.db, "a@example.com", { code: CODE });
    await issueOtp(testDb.db, "b@example.com", { code: CODE });
    await expect(tokens()).resolves.toHaveLength(2);

    // Each code only opens its own account.
    await expect(verifyOtp(testDb.db, "a@example.com", CODE)).resolves.toBe(true);
    await expect(verifyOtp(testDb.db, "a@example.com", CODE)).resolves.toBe(false);
    await expect(verifyOtp(testDb.db, "b@example.com", CODE)).resolves.toBe(true);
  });

  it("returns false when no code was issued", async () => {
    await expect(verifyOtp(testDb.db, EMAIL, CODE)).resolves.toBe(false);
  });

  it("counts failed attempts on the token row", async () => {
    await issueOtp(testDb.db, EMAIL, { code: CODE });
    await verifyOtp(testDb.db, EMAIL, "000001");
    await verifyOtp(testDb.db, EMAIL, "000002");
    expect(await tokens()).toMatchObject([{ attempts: 2 }]);
  });

  it(`invalidates the code after ${OTP_MAX_ATTEMPTS} failed attempts`, async () => {
    await issueOtp(testDb.db, EMAIL, { code: CODE });

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await expect(verifyOtp(testDb.db, EMAIL, `00000${i}`)).resolves.toBe(false);
    }

    // The code is gone: even the right value is refused now.
    await expect(tokens()).resolves.toHaveLength(0);
    await expect(verifyOtp(testDb.db, EMAIL, CODE)).resolves.toBe(false);
  });

  it("still accepts the right code on the last allowed attempt", async () => {
    await issueOtp(testDb.db, EMAIL, { code: CODE });
    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) {
      await verifyOtp(testDb.db, EMAIL, `00000${i}`);
    }
    await expect(verifyOtp(testDb.db, EMAIL, CODE)).resolves.toBe(true);
  });

  it("evaluates at most the allowed number of concurrent guesses", async () => {
    await issueOtp(testDb.db, EMAIL, { code: CODE });

    // 200 guesses at once (what a tRPC batch or parallel requests amount
    // to), with the right code as the very last one.
    const guesses = Array.from({ length: 199 }, (_, i) => String(i).padStart(6, "0"));
    const results = await Promise.all(
      [...guesses, CODE].map((guess) => verifyOtp(testDb.db, EMAIL, guess)),
    );

    expect(results.filter(Boolean)).toHaveLength(0);
    await expect(tokens()).resolves.toHaveLength(0);
  });

  it("accepts a code only once under concurrent use", async () => {
    await issueOtp(testDb.db, EMAIL, { code: CODE });
    const results = await Promise.all(
      Array.from({ length: 3 }, () => verifyOtp(testDb.db, EMAIL, CODE)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("rejects and removes an expired code", async () => {
    const issuedAt = new Date("2030-01-01T00:00:00Z");
    await issueOtp(testDb.db, EMAIL, { code: CODE, now: issuedAt });

    const later = new Date(issuedAt.getTime() + OTP_TTL_MS + 1);
    await expect(verifyOtp(testDb.db, EMAIL, CODE, { now: later })).resolves.toBe(false);
    await expect(tokens()).resolves.toHaveLength(0);
  });

  it("purges expired tokens of any identifier when issuing", async () => {
    const past = new Date(Date.now() - 60_000);
    await testDb.raw.verificationToken.createMany({
      data: [
        { expires: past, identifier: "otp:old@example.com", token: "999999" },
        { expires: past, identifier: "magic@example.com", token: "long-magic-link-token" },
      ],
    });

    await issueOtp(testDb.db, EMAIL, { code: CODE });

    expect((await tokens()).map((t) => t.identifier)).toEqual([otpIdentifier(EMAIL)]);
  });
});
