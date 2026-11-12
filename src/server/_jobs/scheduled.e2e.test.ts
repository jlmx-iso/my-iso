// The scheduled path end to end, as far as it goes without a deploy:
//
//   Cron expression -> runScheduledJobs (what worker.ts calls)
//     -> a real Request carrying the job token
//     -> the real route handler (POST /api/internal/jobs/[name])
//     -> the real job, against a real SQLite database.
//
// Only the last hop of a deployment is missing: Cloudflare invoking
// `scheduled`, and the Worker handing the request to OpenNext. That part is
// exercised with `wrangler dev --test-scheduled` (docs/DEPLOYMENT.md).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const holder: { db: unknown } = { db: null };
  return {
    AUTH_SECRET: "0123456789abcdef0123456789abcdef-scheduled",
    captureServerException: vi.fn(),
    holder,
  };
});

const { AUTH_SECRET } = mocks;

vi.mock("~/env", () => ({ env: { AUTH_SECRET: mocks.AUTH_SECRET, NODE_ENV: "test" } }));
vi.mock("~/server/db", () => ({
  get db() {
    return mocks.holder.db;
  },
}));
vi.mock("~/server/_lib/posthog", () => ({ captureServerException: mocks.captureServerException }));

import { POST } from "~/app/api/internal/jobs/[name]/route";
import { createTestDb, type TestDb } from "~/test/helpers/sqlite";
import { CRON_JOBS, type JobRun, runScheduledJobs } from "~/worker/scheduled";

let testDb: TestDb;
const HOUR = 60 * 60 * 1000;

/** What OpenNext does with the Worker's internal request: route it. */
async function appFetch(request: Request): Promise<Response> {
  const match = /^\/api\/internal\/jobs\/([^/]+)$/.exec(new URL(request.url).pathname);
  if (!match?.[1]) return new Response("Not found", { status: 404 });
  return POST(request, { params: Promise.resolve({ name: match[1] }) });
}

const everyCron = () =>
  Promise.all(Object.keys(CRON_JOBS).map((cron) => runScheduledJobs(cron, { appFetch, authSecret: AUTH_SECRET })));

beforeAll(async () => {
  testDb = await createTestDb();
  mocks.holder.db = testDb.db;
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await testDb.raw.match.deleteMany();
  await testDb.raw.inviteCode.deleteMany();
  await testDb.raw.verificationToken.deleteMany();
  await testDb.raw.pendingInviteValidation.deleteMany();
  await testDb.raw.user.deleteMany();
});

async function seed() {
  const [a, b, c] = await Promise.all(
    ["a", "b", "c"].map((name) =>
      testDb.raw.user.create({
        data: { email: `${name}@example.com`, firstName: name, lastName: "Tester" },
      }),
    ),
  );
  const [user1Id, user2Id] = [a!.id, b!.id].sort();
  const stale = await testDb.raw.match.create({
    data: { expiresAt: new Date(Date.now() - HOUR), status: "matched", user1Id: user1Id!, user2Id: user2Id! },
  });
  await testDb.raw.verificationToken.create({
    data: { expires: new Date(Date.now() - HOUR), identifier: "otp:old@example.com", token: "111111" },
  });
  await testDb.raw.pendingInviteValidation.create({
    data: { code: "OLD", email: "old@example.com", expiresAt: new Date(Date.now() - HOUR) },
  });
  const leaked = await testDb.raw.inviteCode.create({
    data: {
      code: "ISO-LEAK-ABCDEFGH",
      creatorId: c!.id,
      currentRedemptions: 1,
      slotsChangedAt: new Date(Date.now() - HOUR),
    },
  });
  return { leaked, stale };
}

describe("Cron Trigger -> Worker -> route -> job -> database", () => {
  it("every trigger runs its jobs and they change the database", async () => {
    const { leaked, stale } = await seed();

    const runs = (await everyCron()).flat();

    expect(runs.map((run: JobRun) => run.job).sort()).toEqual([
      "expire-matches",
      "finish-deletions",
      "purge-expired",
      "reconcile-invites",
    ]);
    expect(runs.every((run) => run.ok && run.status === 200)).toBe(true);

    expect((await testDb.raw.match.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("expired");
    expect(await testDb.raw.verificationToken.count()).toBe(0);
    expect(await testDb.raw.pendingInviteValidation.count()).toBe(0);
    expect(
      (await testDb.raw.inviteCode.findUniqueOrThrow({ where: { id: leaked.id } })).currentRedemptions,
    ).toBe(0);
    expect(mocks.captureServerException).not.toHaveBeenCalled();
  });

  it("running everything again changes nothing and still succeeds", async () => {
    await seed();
    await everyCron();
    const before = JSON.stringify([
      await testDb.raw.match.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true } }),
      await testDb.raw.inviteCode.findMany({ select: { currentRedemptions: true, id: true } }),
    ]);

    const runs = (await everyCron()).flat();

    expect(runs.every((run) => run.ok)).toBe(true);
    expect(
      JSON.stringify([
        await testDb.raw.match.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true } }),
        await testDb.raw.inviteCode.findMany({ select: { currentRedemptions: true, id: true } }),
      ]),
    ).toBe(before);
  });

  it("the route answers with the job's summary", async () => {
    await seed();
    const summaries: unknown[] = [];
    await runScheduledJobs("*/15 * * * *", {
      appFetch: async (request) => {
        const response = await appFetch(request);
        summaries.push(await response.clone().json());
        return response;
      },
      authSecret: AUTH_SECRET,
    });
    expect(summaries).toEqual([
      expect.objectContaining({ job: "expire-matches", ok: true, summary: { expired: 1 } }),
      expect.objectContaining({ job: "finish-deletions", ok: true, summary: { finished: 0, stuck: 0 } }),
    ]);
  });

  it("a Worker with a different secret is turned away and nothing runs", async () => {
    const { stale } = await seed();
    const runs = await runScheduledJobs("*/15 * * * *", {
      appFetch,
      authSecret: "another-secret-another-secret-another",
    });
    expect(runs).toEqual([
      { job: "expire-matches", ok: false, status: 404 },
      { job: "finish-deletions", ok: false, status: 404 },
    ]);
    expect((await testDb.raw.match.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("matched");
  });

  it("the route refuses a missing token, another job's token and unknown jobs alike", async () => {
    const call = (name: string, authorization?: string) =>
      POST(
        new Request(`https://scheduled.internal/api/internal/jobs/${name}`, {
          headers: authorization ? { Authorization: authorization } : {},
          method: "POST",
        }),
        { params: Promise.resolve({ name }) },
      );

    let purgeToken = "";
    await runScheduledJobs("17 3 * * *", {
      appFetch: async (request) => {
        if (request.url.endsWith("/purge-expired")) purgeToken = request.headers.get("authorization") ?? "";
        return Response.json({});
      },
      authSecret: AUTH_SECRET,
    });
    expect(purgeToken).toMatch(/^Bearer [0-9a-f]{64}$/);

    expect((await call("purge-expired", purgeToken)).status).toBe(200);
    expect((await call("purge-expired")).status).toBe(404);
    expect((await call("purge-expired", "Bearer wrong")).status).toBe(404);
    expect((await call("expire-matches", purgeToken)).status).toBe(404);
    expect((await call("drop-database", purgeToken)).status).toBe(404);
  });

  it("a job that fails is reported, answers 500, and does not stop the next one", async () => {
    await seed();
    const original = testDb.db.verificationToken.deleteMany.bind(testDb.db.verificationToken);
    const failure = new Error("D1 is unavailable");
    const spy = vi
      .spyOn(testDb.db.verificationToken, "deleteMany")
      .mockRejectedValueOnce(failure) as unknown as { mockRestore: () => void };

    const runs = await runScheduledJobs("17 3 * * *", { appFetch, authSecret: AUTH_SECRET });
    spy.mockRestore();
    expect(typeof original).toBe("function");

    expect(runs).toEqual([
      { job: "purge-expired", ok: false, status: 500 },
      { job: "reconcile-invites", ok: true, status: 200 },
    ]);
    expect(mocks.captureServerException).toHaveBeenCalledWith(failure, {
      extra: { job: "purge-expired" },
      source: "job:purge-expired",
    });
  });
});
