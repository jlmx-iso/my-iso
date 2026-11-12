import type { ExtendedPrismaClient } from "~/server/_db/softDelete";

type ReconcileDb = Pick<ExtendedPrismaClient, "inviteCode">;

const MINUTE_MS = 60 * 1000;

/**
 * A code whose slots changed this recently may have a sign-up in flight: its
 * slot is claimed, its redemption row not yet written. Left alone until the
 * next run.
 */
export const SETTLE_MS = 15 * MINUTE_MS;

/** Codes read per statement. */
const BATCH_SIZE = 50;
/** Upper bound on the work of one run; the rest waits for the next one. */
const MAX_BATCHES = 20;

/**
 * Sets `InviteCode.currentRedemptions` back to the number of redemptions
 * actually recorded, for codes whose slots were claimed or released and
 * have since settled.
 *
 * Why it can be wrong: sign-up claims a slot (counter + 1) before it writes
 * the redemption, and gives the slot back if a later step fails. A Worker
 * that dies in between leaves the counter one too high, and the inviter one
 * invite short.
 *
 * What it reconciles against is `redeemedCount`, not the number of
 * redemption rows. The rule is that a used invite stays used: redemption
 * rows disappear when the invited member's account is deleted (cascade),
 * while `redeemedCount` is raised by a database trigger in the same
 * statement that inserts a redemption and is never lowered. Counting rows
 * would hand a slot back for every deleted account.
 *
 * `slotsChangedAt` is the work queue: claiming or releasing a slot sets it,
 * and this job clears it once it has examined the code (corrected or found
 * right). A code therefore stays queued until it has been looked at, however
 * many codes are waiting and however long the job did not run; there is no
 * lookback window for one to age out of. Oldest first, so a backlog is
 * worked through in order across runs.
 *
 * Idempotent. Each write is a conditional UPDATE that only applies if the
 * counters and the stamp still hold the values just read, so a sign-up that
 * claims a slot while the job runs is never overwritten and its fresh stamp
 * is never cleared; that code is simply picked up by a later run.
 */
export async function reconcileInviteSlots(
  db: ReconcileDb,
  now: Date = new Date(),
): Promise<{ checked: number; corrected: number }> {
  const settledBefore = new Date(now.getTime() - SETTLE_MS);

  let checked = 0;
  let corrected = 0;
  // Within a run, codes whose write lost a race keep their stamp; the
  // cursor keeps them from being read again until the next run.
  let cursor: { id: string; slotsChangedAt: Date } | undefined;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const codes = await db.inviteCode.findMany({
      orderBy: [{ slotsChangedAt: "asc" }, { id: "asc" }],
      select: {
        currentRedemptions: true,
        id: true,
        redeemedCount: true,
        slotsChangedAt: true,
      },
      take: BATCH_SIZE,
      where: {
        slotsChangedAt: { lt: settledBefore, not: null },
        ...(cursor
          ? {
              OR: [
                { slotsChangedAt: { gt: cursor.slotsChangedAt } },
                { id: { gt: cursor.id }, slotsChangedAt: cursor.slotsChangedAt },
              ],
            }
          : {}),
      },
    });
    if (codes.length === 0) break;
    checked += codes.length;

    for (const code of codes) {
      if (code.slotsChangedAt === null) continue;
      cursor = { id: code.id, slotsChangedAt: code.slotsChangedAt };
      const actual = code.redeemedCount;
      const result = await db.inviteCode.updateMany({
        data: { currentRedemptions: actual, slotsChangedAt: null },
        where: {
          currentRedemptions: code.currentRedemptions,
          id: code.id,
          redeemedCount: actual,
          slotsChangedAt: code.slotsChangedAt,
        },
      });
      if (code.currentRedemptions !== actual) corrected += result.count;
    }

    if (codes.length < BATCH_SIZE) break;
  }

  return { checked, corrected };
}
