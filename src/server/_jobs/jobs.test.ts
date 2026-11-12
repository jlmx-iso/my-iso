import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ captureServerException: vi.fn() }));
vi.mock("~/server/_lib/posthog", () => ({ captureServerException: mocks.captureServerException }));

import { jobToken } from "~/_lib/jobToken";
import { claimInviteSlot, releaseInviteSlot } from "~/server/_db/invite";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { consumeRateLimit, RateLimits } from "~/server/_utils/rateLimit";
import { createTestDb, type TestDb } from "~/test/helpers/sqlite";
import { CRON_JOBS, runScheduledJobs } from "~/worker/scheduled";

import { isJobName, JOBS, runJob } from ".";
import { expireStaleMatches, isMatchExpired, liveMatchFilter } from "./expireStaleMatches";
import { purgeExpired } from "./purgeExpired";
import { LOOKBACK_MS, reconcileInviteSlots, SETTLE_MS } from "./reconcileInviteSlots";


const NOW = new Date("2026-11-12T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);

let testDb: TestDb;
let userCount = 0;

async function createUser(): Promise<string> {
  userCount += 1;
  const user = await testDb.raw.user.create({
    data: { email: `user${userCount}@example.com`, firstName: "Test", lastName: `User${userCount}` },
  });
  return user.id;
}

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await testDb.raw.match.deleteMany();
  await testDb.raw.inviteRedemption.deleteMany();
  await testDb.raw.inviteCode.deleteMany();
  await testDb.raw.verificationToken.deleteMany();
  await testDb.raw.pendingInviteValidation.deleteMany();
  await testDb.raw.$executeRaw`DELETE FROM "RateLimit"`;
  await testDb.raw.user.deleteMany();
});

describe("expireStaleMatches", () => {
  async function createMatch(data: { expiresAt: Date | null; status: string }) {
    const [a, b] = [await createUser(), await createUser()].sort();
    return testDb.raw.match.create({ data: { ...data, user1Id: a!, user2Id: b! } });
  }

  it("expires matched rows past their deadline and nothing else", async () => {
    const stale = await createMatch({ expiresAt: ago(HOUR), status: "matched" });
    const live = await createMatch({ expiresAt: ahead(HOUR), status: "matched" });
    const messaged = await createMatch({ expiresAt: ago(HOUR), status: "messaged" });
    const open = await createMatch({ expiresAt: null, status: "matched" });

    await expect(expireStaleMatches(testDb.db, NOW)).resolves.toEqual({ expired: 1 });

    const status = async (id: string) =>
      (await testDb.raw.match.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(stale.id)).toBe("expired");
    expect(await status(live.id)).toBe("matched");
    expect(await status(messaged.id)).toBe("messaged");
    expect(await status(open.id)).toBe("matched");
  });

  it("is idempotent", async () => {
    await createMatch({ expiresAt: ago(HOUR), status: "matched" });
    await expect(expireStaleMatches(testDb.db, NOW)).resolves.toEqual({ expired: 1 });
    await expect(expireStaleMatches(testDb.db, NOW)).resolves.toEqual({ expired: 0 });
  });

  it("read-time expiry agrees with the job before the job has run", async () => {
    const stale = await createMatch({ expiresAt: ago(HOUR), status: "matched" });
    const live = await createMatch({ expiresAt: ahead(HOUR), status: "matched" });
    const messaged = await createMatch({ expiresAt: ago(HOUR), status: "messaged" });
    const open = await createMatch({ expiresAt: null, status: "matched" });
    const done = await createMatch({ expiresAt: ahead(HOUR), status: "expired" });

    const visible = await testDb.db.match.findMany({ where: liveMatchFilter(NOW) });
    expect(visible.map((m) => m.id).sort()).toEqual([live.id, messaged.id, open.id].sort());

    expect(isMatchExpired(stale, NOW)).toBe(true);
    expect(isMatchExpired(done, NOW)).toBe(true);
    expect(isMatchExpired(live, NOW)).toBe(false);
    expect(isMatchExpired(messaged, NOW)).toBe(false);
    expect(isMatchExpired(open, NOW)).toBe(false);
  });
});

describe("purgeExpired", () => {
  it("deletes expired sign-in codes, pending invites and rate-limit rows only", async () => {
    await testDb.raw.verificationToken.createMany({
      data: [
        { expires: ago(HOUR), identifier: "otp:old@example.com", token: "111111" },
        { expires: ahead(HOUR), identifier: "otp:new@example.com", token: "222222" },
      ],
    });
    await testDb.raw.pendingInviteValidation.createMany({
      data: [
        { code: "OLD", email: "old@example.com", expiresAt: ago(HOUR) },
        { code: "NEW", email: "new@example.com", expiresAt: ahead(HOUR) },
      ],
    });
    // One window that ended yesterday, one that is open now.
    await consumeRateLimit(testDb.db, RateLimits.SWIPE, "user:old", {
      nowMs: NOW.getTime() - 24 * HOUR,
      random: () => 1,
    });
    await consumeRateLimit(testDb.db, RateLimits.SWIPE, "user:new", {
      nowMs: NOW.getTime(),
      random: () => 1,
    });

    await expect(purgeExpired(testDb.db, NOW)).resolves.toEqual({
      pendingInvites: 1,
      rateLimits: 1,
      verificationTokens: 1,
    });

    expect((await testDb.raw.verificationToken.findMany()).map((t) => t.token)).toEqual(["222222"]);
    expect((await testDb.raw.pendingInviteValidation.findMany()).map((p) => p.code)).toEqual(["NEW"]);
    const remaining = await testDb.raw.$queryRaw<unknown[]>`SELECT "key" FROM "RateLimit"`;
    expect(remaining).toHaveLength(1);
  });

  it("is idempotent", async () => {
    await testDb.raw.verificationToken.create({
      data: { expires: ago(HOUR), identifier: "otp:old@example.com", token: "111111" },
    });
    await purgeExpired(testDb.db, NOW);
    await expect(purgeExpired(testDb.db, NOW)).resolves.toEqual({
      pendingInvites: 0,
      rateLimits: 0,
      verificationTokens: 0,
    });
  });
});

describe("reconcileInviteSlots", () => {
  async function createCode(data: {
    code: string;
    currentRedemptions: number;
    redemptions?: number;
    slotsChangedAt: Date | null;
  }) {
    const creatorId = await createUser();
    const invite = await testDb.raw.inviteCode.create({
      data: {
        code: data.code,
        creatorId,
        currentRedemptions: data.currentRedemptions,
        slotsChangedAt: data.slotsChangedAt,
      },
    });
    for (let i = 0; i < (data.redemptions ?? 0); i++) {
      await testDb.raw.inviteRedemption.create({
        data: { inviteCodeId: invite.id, redeemedById: await createUser() },
      });
    }
    return invite;
  }

  const count = async (id: string) =>
    (await testDb.raw.inviteCode.findUniqueOrThrow({ where: { id } })).currentRedemptions;

  it("gives back a slot leaked by a sign-up that died after claiming it", async () => {
    const leaked = await createCode({
      code: "LEAKED",
      currentRedemptions: 3,
      redemptions: 2,
      slotsChangedAt: ago(HOUR),
    });
    const correct = await createCode({
      code: "CORRECT",
      currentRedemptions: 1,
      redemptions: 1,
      slotsChangedAt: ago(HOUR),
    });

    await expect(reconcileInviteSlots(testDb.db, NOW)).resolves.toEqual({ checked: 2, corrected: 1 });
    expect(await count(leaked.id)).toBe(2);
    expect(await count(correct.id)).toBe(1);
  });

  it("is idempotent", async () => {
    await createCode({ code: "LEAKED", currentRedemptions: 2, redemptions: 0, slotsChangedAt: ago(HOUR) });
    await expect(reconcileInviteSlots(testDb.db, NOW)).resolves.toEqual({ checked: 1, corrected: 1 });
    await expect(reconcileInviteSlots(testDb.db, NOW)).resolves.toEqual({ checked: 1, corrected: 0 });
  });

  it("leaves a code alone while a sign-up may still be in flight", async () => {
    const inFlight = await createCode({
      code: "INFLIGHT",
      currentRedemptions: 1,
      redemptions: 0,
      slotsChangedAt: ago(SETTLE_MS - 1000),
    });
    await expect(reconcileInviteSlots(testDb.db, NOW)).resolves.toEqual({ checked: 0, corrected: 0 });
    expect(await count(inFlight.id)).toBe(1);

    // Once it has settled, the next run corrects it.
    const later = new Date(NOW.getTime() + SETTLE_MS);
    await expect(reconcileInviteSlots(testDb.db, later)).resolves.toEqual({ checked: 1, corrected: 1 });
    expect(await count(inFlight.id)).toBe(0);
  });

  it("a used invite stays used when the invited member's account is deleted", async () => {
    const invite = await createCode({
      code: "DELETED",
      currentRedemptions: 2,
      redemptions: 2,
      slotsChangedAt: ago(HOUR),
    });
    const stored = await testDb.raw.inviteCode.findUniqueOrThrow({ where: { id: invite.id } });
    expect(stored.redeemedCount).toBe(2);

    // The account goes, and with it (cascade) the redemption row.
    const [redemption] = await testDb.raw.inviteRedemption.findMany({
      where: { inviteCodeId: invite.id },
    });
    await testDb.raw.user.delete({ where: { id: redemption!.redeemedById } });
    expect(await testDb.raw.inviteRedemption.count({ where: { inviteCodeId: invite.id } })).toBe(1);

    await expect(reconcileInviteSlots(testDb.db, NOW)).resolves.toEqual({ checked: 1, corrected: 0 });
    expect(await count(invite.id)).toBe(2);
  });

  it("still frees a leaked slot on a code that also lost a redeemer", async () => {
    const invite = await createCode({
      code: "BOTH",
      currentRedemptions: 3,
      redemptions: 2,
      slotsChangedAt: ago(HOUR),
    });
    const [redemption] = await testDb.raw.inviteRedemption.findMany({
      where: { inviteCodeId: invite.id },
    });
    await testDb.raw.user.delete({ where: { id: redemption!.redeemedById } });

    // Two were really used (one account since deleted), one claim leaked.
    await expect(reconcileInviteSlots(testDb.db, NOW)).resolves.toEqual({ checked: 1, corrected: 1 });
    expect(await count(invite.id)).toBe(2);
  });

  it("only looks at codes touched recently", async () => {
    const never = await createCode({ code: "NEVER", currentRedemptions: 1, slotsChangedAt: null });
    const longAgo = await createCode({
      code: "LONGAGO",
      currentRedemptions: 1,
      slotsChangedAt: ago(LOOKBACK_MS + HOUR),
    });
    await expect(reconcileInviteSlots(testDb.db, NOW)).resolves.toEqual({ checked: 0, corrected: 0 });
    expect(await count(never.id)).toBe(1);
    expect(await count(longAgo.id)).toBe(1);
  });

  it("sees the stamp that claiming and releasing a slot leave", async () => {
    const invite = await createCode({ code: "STAMPED", currentRedemptions: 0, slotsChangedAt: null });

    // A claim whose sign-up never finished: counter 1, no redemption row.
    const slot = await claimInviteSlot(testDb.db, "STAMPED");
    expect(slot?.inviteCodeId).toBe(invite.id);
    const stamped = await testDb.raw.inviteCode.findUniqueOrThrow({ where: { id: invite.id } });
    expect(stamped.slotsChangedAt).toBeInstanceOf(Date);
    expect(Math.abs((stamped.slotsChangedAt?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);

    const afterSettling = new Date(Date.now() + SETTLE_MS + 1000);
    await expect(reconcileInviteSlots(testDb.db, afterSettling)).resolves.toEqual({
      checked: 1,
      corrected: 1,
    });
    expect(await count(invite.id)).toBe(0);

    // Releasing stamps too.
    await testDb.raw.inviteCode.update({
      data: { currentRedemptions: 1, slotsChangedAt: null },
      where: { id: invite.id },
    });
    await releaseInviteSlot(testDb.db, invite.id);
    const released = await testDb.raw.inviteCode.findUniqueOrThrow({ where: { id: invite.id } });
    expect(released.currentRedemptions).toBe(0);
    expect(released.slotsChangedAt).toBeInstanceOf(Date);
  });

  it("does not overwrite a claim made while it runs", async () => {
    const invite = await createCode({
      code: "RACE",
      currentRedemptions: 2,
      redemptions: 1,
      slotsChangedAt: ago(HOUR),
    });

    // The job has read the row (counter 2); a sign-up now claims a slot
    // before the job writes.
    const racing = {
      inviteCode: {
        findMany: testDb.db.inviteCode.findMany.bind(testDb.db.inviteCode),
        updateMany: async (args: Parameters<typeof testDb.db.inviteCode.updateMany>[0]) => {
          await claimInviteSlot(testDb.db, "RACE");
          return testDb.db.inviteCode.updateMany(args);
        },
      },
    } as unknown as Pick<ExtendedPrismaClient, "inviteCode">;

    await expect(reconcileInviteSlots(racing, NOW)).resolves.toEqual({ checked: 1, corrected: 0 });
    expect(await count(invite.id)).toBe(3);
  });

  it("works through more codes than one batch, within the bound-parameter limit", async () => {
    for (let i = 0; i < 120; i++) {
      await createCode({ code: `BULK${i}`, currentRedemptions: 1, slotsChangedAt: ago(HOUR) });
    }
    await expect(reconcileInviteSlots(testDb.db, NOW)).resolves.toEqual({
      checked: 120,
      corrected: 120,
    });
    expect(await testDb.raw.inviteCode.count({ where: { currentRedemptions: { gt: 0 } } })).toBe(0);
  });
});

describe("runJob", () => {
  it("returns the job's summary", async () => {
    const outcome = await runJob("expire-matches", testDb.db, NOW);
    expect(outcome).toMatchObject({ job: "expire-matches", ok: true, summary: { expired: 0 } });
    expect(mocks.captureServerException).not.toHaveBeenCalled();
  });

  it("reports a failure to error tracking and does not throw", async () => {
    const failure = new Error("D1 is unavailable");
    const broken = {
      match: { updateMany: vi.fn().mockRejectedValue(failure) },
    } as unknown as ExtendedPrismaClient;

    const outcome = await runJob("expire-matches", broken, NOW);

    expect(outcome).toMatchObject({ job: "expire-matches", ok: false });
    expect(mocks.captureServerException).toHaveBeenCalledWith(failure, {
      extra: { job: "expire-matches" },
      source: "job:expire-matches",
    });
  });

  it("knows its job names", () => {
    expect(isJobName("purge-expired")).toBe(true);
    expect(isJobName("drop-database")).toBe(false);
    expect(isJobName("toString")).toBe(false);
  });
});

describe("the schedule", () => {
  const wranglerToml = readFileSync(path.resolve(__dirname, "../../../wrangler.toml"), "utf8");

  it("only names jobs that exist, and schedules every job", () => {
    const scheduled = Object.values(CRON_JOBS).flat();
    for (const job of scheduled) expect(isJobName(job), job).toBe(true);
    expect([...new Set(scheduled)].sort()).toEqual(Object.keys(JOBS).sort());
  });

  it("matches the Cron Triggers in wrangler.toml, in both environments", () => {
    const blocks = [...wranglerToml.matchAll(/^\[(?:env\.(\w+)\.)?triggers\]\ncrons = (\[.*\])$/gm)];
    expect(blocks.map((block) => block[1] ?? "production").sort()).toEqual(["production", "staging"]);
    for (const block of blocks) {
      const crons = JSON.parse(block[2] ?? "[]") as string[];
      expect(crons.sort()).toEqual(Object.keys(CRON_JOBS).sort());
    }
  });

  it("sets APP_ENV for both environments", () => {
    expect(wranglerToml).toMatch(/^\[vars\]\n(?:.*\n)*?APP_ENV = "production"$/m);
    expect(wranglerToml).toMatch(/^\[env\.staging\.vars\]\n(?:.*\n)*?APP_ENV = "staging"$/m);
  });
});

describe("runScheduledJobs (Worker side)", () => {
  const SECRET = "0123456789abcdef0123456789abcdef";

  it("calls each job of the trigger with a token bound to that job", async () => {
    const seen: Array<{ authorization: string | null; method: string; path: string }> = [];
    const appFetch = vi.fn(async (request: Request) => {
      seen.push({
        authorization: request.headers.get("authorization"),
        method: request.method,
        path: new URL(request.url).pathname,
      });
      return Response.json({ ok: true });
    });

    const runs = await runScheduledJobs("17 3 * * *", { appFetch, authSecret: SECRET });

    expect(runs).toEqual([
      { job: "purge-expired", ok: true, status: 200 },
      { job: "reconcile-invites", ok: true, status: 200 },
    ]);
    expect(seen).toEqual([
      {
        authorization: `Bearer ${await jobToken(SECRET, "purge-expired")}`,
        method: "POST",
        path: "/api/internal/jobs/purge-expired",
      },
      {
        authorization: `Bearer ${await jobToken(SECRET, "reconcile-invites")}`,
        method: "POST",
        path: "/api/internal/jobs/reconcile-invites",
      },
    ]);
    expect(await jobToken(SECRET, "purge-expired")).not.toBe(await jobToken(SECRET, "reconcile-invites"));
    expect(await jobToken(SECRET, "purge-expired")).not.toBe(await jobToken(`${SECRET}x`, "purge-expired"));
  });

  it("keeps going after a job fails and reports which", async () => {
    const appFetch = vi
      .fn<(request: Request) => Promise<Response>>()
      .mockRejectedValueOnce(new Error("isolate reset"))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const runs = await runScheduledJobs("17 3 * * *", { appFetch, authSecret: SECRET });

    expect(runs).toEqual([
      { job: "purge-expired", ok: false, status: 0 },
      { job: "reconcile-invites", ok: false, status: 500 },
    ]);
    consoleError.mockRestore();
  });

  it("refuses an unknown cron expression or a missing secret", async () => {
    const appFetch = vi.fn();
    await expect(runScheduledJobs("* * * * *", { appFetch, authSecret: SECRET })).rejects.toThrow(
      /No jobs are configured/,
    );
    await expect(
      runScheduledJobs("17 3 * * *", { appFetch, authSecret: undefined }),
    ).rejects.toThrow(/AUTH_SECRET/);
    expect(appFetch).not.toHaveBeenCalled();
  });
});
