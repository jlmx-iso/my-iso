import { logger } from "~/_utils";
import { type DeletionDb, type DeletionDeps, runAccountDeletion } from "~/server/_lib/account/deletion";
import { accountDeletionDeps } from "~/server/_lib/account/deletionDeps";
import { captureServerException } from "~/server/_lib/posthog";

/** A deletion is retried no sooner than this after its last attempt. */
export const DELETION_RETRY_AFTER_MS = 10 * 60 * 1000;

/** Accounts tried per run; the rest wait for the next run (every 15 minutes). */
export const DELETION_BATCH = 10;

/**
 * Attempts after which an account is no longer retried: it needs a person
 * (it is reported, with a stable fingerprint, when it reaches this).
 */
export const MAX_DELETION_ATTEMPTS = 5;

/**
 * Finishes account deletions that a request started but could not complete
 * (Stripe, Cloudinary, a chat room, PostHog or the database failed
 * part-way; see ~/server/_lib/account/deletion). Each run of
 * runAccountDeletion repeats only what is left, so retrying is safe.
 *
 * - Least recently tried first, so an account that keeps failing does not
 *   hold the batch: the others move ahead of it.
 * - Every failure is reported; an account that has failed
 *   MAX_DELETION_ATTEMPTS times is reported as stuck and left out.
 * - The job itself fails (runJob reports it) when any account failed.
 */
export async function finishAccountDeletions(
  db: DeletionDb,
  now: Date = new Date(),
  deps: DeletionDeps = accountDeletionDeps,
): Promise<{ finished: number; stuck: number }> {
  const cutoff = new Date(now.getTime() - DELETION_RETRY_AFTER_MS);
  const pending = await db.user.findMany({
    orderBy: [{ deletionAttemptedAt: "asc" }, { deletionRequestedAt: "asc" }],
    select: { id: true },
    take: DELETION_BATCH,
    where: {
      OR: [{ deletionAttemptedAt: null }, { deletionAttemptedAt: { lt: cutoff } }],
      deletedAt: null,
      deletionAttempts: { lt: MAX_DELETION_ATTEMPTS },
      deletionRequestedAt: { lt: cutoff },
      isDeleted: true,
    },
  });

  let finished = 0;
  let failed = 0;
  for (const { id } of pending) {
    try {
      if ((await runAccountDeletion(db, id, deps, now)) === "finished") finished += 1;
    } catch (error) {
      failed += 1;
      logger.error("Could not finish an account deletion; retrying on a later run", { error });
      captureServerException(error, {
        extra: { $exception_fingerprint: "account-deletion-failed" },
        source: "job:finish-deletions",
      });
    }
  }

  const stuck = await db.user.count({
    where: { deletedAt: null, deletionAttempts: { gte: MAX_DELETION_ATTEMPTS }, isDeleted: true },
  });
  if (stuck > 0) {
    // One issue in error tracking, whatever the account; the ids are in the
    // database (docs/DATABASE.md, "Account deletion").
    captureServerException(new Error(`${stuck} account deletion(s) stuck after ${MAX_DELETION_ATTEMPTS} attempts`), {
      extra: { $exception_fingerprint: "account-deletion-stuck", stuck },
      source: "job:finish-deletions",
    });
  }
  if (failed > 0) {
    throw new Error(`${failed} account deletion(s) failed this run (${finished} finished, ${stuck} stuck)`);
  }
  return { finished, stuck };
}
