import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUPPORT_EMAIL } from "~/_lib/site";
import { Result } from "~/_utils/result";
import { createDbCaller } from "~/test/helpers/dbCaller";
import { makePro } from "~/test/helpers/pro";
import { freezeRateLimitClock } from "~/test/helpers/rateLimitClock";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_args: { email: string; subject: string; html: string }) => Result.ok({ success: true })),
}));

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("~/_lib", () => ({ cloudinaryClient: null }));
vi.mock("~/server/_lib/email", () => ({ sendEmail }));

import { supportInbox, supportRouter, supportSubject } from "./support";

freezeRateLimitClock();

type TestUser = { email: string; id: string };

describe("support.contact (priority support)", () => {
  let testDb: TestDb;
  let member: TestUser;

  const as = (user: TestUser) => createDbCaller(supportRouter, testDb.db, { user });
  const request = { message: "My invoice shows the wrong amount.", subject: "Billing question" };

  beforeEach(async () => {
    testDb = await createTestDb();
    member = await createTestUser(testDb.db, { firstName: "Olive", lastName: "Owner" });
    sendEmail.mockClear();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("is Pro only: a member without Pro is refused and nothing is sent", async () => {
    await expect(as(member).contact(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends to the support inbox, tagged Pro, with the member's id and nothing more", async () => {
    await makePro(testDb.db, member.id);

    await expect(as(member).contact(request)).resolves.toEqual({ sent: true });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0]?.[0];
    expect(sent?.email).toBe(supportInbox());
    expect(sent?.subject).toBe("[Pro] Billing question");
    expect(sent?.html).toContain(member.id);
    expect(sent?.html).toContain("My invoice shows the wrong amount.");
    expect(sent?.html).not.toContain(member.email);
    expect(sent?.html).not.toContain("Olive");
  });

  it("escapes the member's text", async () => {
    await makePro(testDb.db, member.id);
    await as(member).contact({ message: "<script>alert(1)</script> please help", subject: "Hi\n<b>there</b>" });
    const sent = sendEmail.mock.calls[0]?.[0];
    expect(sent?.html).not.toContain("<script>");
    expect(sent?.html).toContain("&lt;script&gt;");
    expect(sent?.subject).toBe("[Pro] Hi <b>there</b>");
  });

  it("validates the input", async () => {
    await makePro(testDb.db, member.id);
    await expect(as(member).contact({ message: "short", subject: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(as(member).contact({ message: request.message, subject: " " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("is rate limited per member", async () => {
    await makePro(testDb.db, member.id);
    for (let index = 0; index < 5; index += 1) await as(member).contact(request);
    await expect(as(member).contact(request)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(sendEmail).toHaveBeenCalledTimes(5);
  });

  it("says so, and where to write instead, when the email cannot be sent", async () => {
    await makePro(testDb.db, member.id);
    sendEmail.mockResolvedValueOnce(Result.err(new Error("RESEND_API_KEY is not configured")) as never);

    const error = await as(member).contact(request).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect((error as Error).message).toContain(SUPPORT_EMAIL);
  });
});

describe("support helpers", () => {
  it("tags the subject", () => {
    expect(supportSubject("Help")).toBe("[Pro] Help");
  });

  it("falls back to the public support address", () => {
    expect(supportInbox()).toBe(SUPPORT_EMAIL);
  });
});
