import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/_lib/posthog", () => ({ captureServerException: vi.fn() }));

import { type DeletionDeps, requestAccountDeletion, runAccountDeletion } from "~/server/_lib/account/deletion";
import { captureServerException } from "~/server/_lib/posthog";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import {
  DELETION_BATCH,
  DELETION_RETRY_AFTER_MS,
  finishAccountDeletions,
  MAX_DELETION_ATTEMPTS,
} from "./finishAccountDeletions";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await testDb.raw.subscription.deleteMany();
  await testDb.raw.user.deleteMany();
});

const NOW = new Date("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function recordingDeps(overrides: Partial<DeletionDeps> = {}): DeletionDeps & { emailed: string[] } {
  const emailed: string[] = [];
  return {
    deleteImages: async () => undefined,
    emailed,
    endBilling: async () => undefined,
    eraseAnalytics: async () => "requested",
    revokeRealtime: async () => undefined,
    sendConfirmation: async ({ email }) => void emailed.push(email),
    ...overrides,
  };
}

async function pendingDeletion(requestedAt: Date) {
  const user = await createTestUser(testDb.db);
  await requestAccountDeletion(testDb.db, user.id, requestedAt);
  return user;
}

const finishedIds = async () =>
  (await testDb.raw.user.findMany({ select: { id: true }, where: { deletedAt: { not: null } } })).map((row) => row.id);

/** An active subscription, so that the deletion calls `endBilling` for it. */
const subscribe = (userId: string) =>
  testDb.raw.subscription.create({
    data: {
      isActive: true,
      isCanceled: false,
      isExpired: false,
      isLifetime: false,
      isPaused: false,
      isPending: false,
      isTrial: false,
      status: "active",
      subscriptionId: `sub_${userId}`,
      userId,
    },
  });

describe("finishAccountDeletions", () => {
  it("finishes deletions left unfinished, and leaves recent and live accounts alone", async () => {
    const stale = await pendingDeletion(ago(DELETION_RETRY_AFTER_MS + 1000));
    const recent = await pendingDeletion(ago(60 * 1000));
    const live = await createTestUser(testDb.db);

    const deps = recordingDeps();
    await expect(finishAccountDeletions(testDb.db, NOW, deps)).resolves.toEqual({ finished: 1, stuck: 0 });
    expect(deps.emailed).toEqual([stale.email]);
    expect(await finishedIds()).toEqual([stale.id]);
    expect(recent.id).not.toBe(live.id);

    // Idempotent: nothing left to do for the same moment.
    await expect(finishAccountDeletions(testDb.db, NOW, recordingDeps())).resolves.toEqual({ finished: 0, stuck: 0 });
  });

  it("fails the run and reports each failure, but keeps going past it", async () => {
    const broken = await pendingDeletion(ago(DELETION_RETRY_AFTER_MS * 3));
    const fine = await pendingDeletion(ago(DELETION_RETRY_AFTER_MS * 2));
    await subscribe(broken.id);
    const deps = recordingDeps({
      endBilling: async (subscriptionId) => {
        if (subscriptionId === `sub_${broken.id}`) throw new Error("Stripe is down");
      },
    });

    await expect(finishAccountDeletions(testDb.db, NOW, deps)).rejects.toThrow(/1 account deletion\(s\) failed/);
    expect(await finishedIds()).toEqual([fine.id]);
    expect(captureServerException).toHaveBeenCalledWith(expect.objectContaining({ message: "Stripe is down" }), {
      extra: { $exception_fingerprint: "account-deletion-failed" },
      source: "job:finish-deletions",
    });
    const row = await testDb.raw.user.findUniqueOrThrow({ where: { id: broken.id } });
    expect(row).toMatchObject({ deletionAttemptedAt: NOW, deletionAttempts: 1 });

    // Not retried until the retry interval has passed since that attempt.
    await expect(finishAccountDeletions(testDb.db, NOW, recordingDeps())).resolves.toEqual({ finished: 0, stuck: 0 });
    const later = new Date(NOW.getTime() + DELETION_RETRY_AFTER_MS + 1000);
    await expect(finishAccountDeletions(testDb.db, later, recordingDeps())).resolves.toEqual({ finished: 1, stuck: 0 });
  });

  it("does not let a permanently failing account block the ones after it, and reports it as stuck", async () => {
    const broken = await pendingDeletion(ago(DELETION_RETRY_AFTER_MS * 100));
    await subscribe(broken.id);
    const failing = recordingDeps({
      endBilling: async () => {
        throw new Error("always fails");
      },
    });

    let at = NOW.getTime();
    for (let attempt = 0; attempt < MAX_DELETION_ATTEMPTS; attempt++) {
      at += DELETION_RETRY_AFTER_MS + 1000;
      await expect(finishAccountDeletions(testDb.db, new Date(at), failing)).rejects.toThrow();
    }
    // Given up on: left out, and reported as stuck once there.
    const late = await pendingDeletion(new Date(at - DELETION_RETRY_AFTER_MS * 2));
    at += DELETION_RETRY_AFTER_MS + 1000;
    vi.clearAllMocks();
    await expect(finishAccountDeletions(testDb.db, new Date(at), failing)).resolves.toEqual({ finished: 1, stuck: 1 });
    expect(await finishedIds()).toEqual([late.id]);
    expect(captureServerException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { $exception_fingerprint: "account-deletion-stuck", stuck: 1 },
      source: "job:finish-deletions",
    });
  });

  it("tries the least recently tried first, in bounded batches", async () => {
    const users = [];
    for (let i = 0; i <= DELETION_BATCH; i++) {
      users.push(await pendingDeletion(ago(DELETION_RETRY_AFTER_MS + (DELETION_BATCH + 1 - i) * 1000)));
    }
    await expect(finishAccountDeletions(testDb.db, NOW, recordingDeps())).resolves.toEqual({
      finished: DELETION_BATCH,
      stuck: 0,
    });
    const newest = users[users.length - 1];
    expect(await finishedIds()).not.toContain(newest?.id);
  });

  it("counts a deletion another run finished first as not finished by this one", async () => {
    const user = await pendingDeletion(ago(DELETION_RETRY_AFTER_MS * 2));
    await subscribe(user.id);
    const racing = recordingDeps({
      endBilling: async () => {
        await runAccountDeletion(testDb.db, user.id, recordingDeps(), NOW);
      },
    });
    await expect(finishAccountDeletions(testDb.db, NOW, racing)).resolves.toEqual({ finished: 0, stuck: 0 });
  });
});
