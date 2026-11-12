import type { ExtendedPrismaClient } from "~/server/_db/softDelete";

type ReconcileDb = Pick<ExtendedPrismaClient, "inviteCode">;

const MINUTE_MS = 60 * 1000;

/**
 * A code whose slots changed this recently may have a sign-up in flight: its
 * slot is claimed, its redemption row not yet written. Left alone until the
 * next run.
 */
export const SETTLE_MS = 15 * MINUTE_MS;

/** How far back a run looks. Comfortably more than the time between runs. */
export const LOOKBACK_MS = 7 * 24 * 60 * MINUTE_MS;

/** Codes read per statement. */
const BATCH_SIZE = 50;
/** Upper bound on the work of one run; the rest waits for the next one. */
const MAX_BATCHES = 20;

/**
 * Sets `InviteCode.currentRedemptions` back to the number of redemptions
 * actually recorded, for codes whose slots were claimed or released within
 * the lookback window and have since settled.
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
 * Idempotent. Each correction is a conditional UPDATE that only applies if
 * the counters and the stamp still hold the values just read, so a sign-up
 * that claims a slot while the job runs is never overwritten; that code is
 * simply picked up by the next run.
 */
export async function reconcileInviteSlots(
  db: ReconcileDb,
  now: Date = new Date(),
): Promise<{ checked: number; corrected: number }> {
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const settledBefore = new Date(now.getTime() - SETTLE_MS);

  let checked = 0;
  let corrected = 0;
  let cursor: string | undefined;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const codes = await db.inviteCode.findMany({
      orderBy: { id: "asc" },
      select: {
        currentRedemptions: true,
        id: true,
        redeemedCount: true,
        slotsChangedAt: true,
      },
      take: BATCH_SIZE,
      where: {
        slotsChangedAt: { gte: since, lt: settledBefore },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
    });
    if (codes.length === 0) break;
    checked += codes.length;
    cursor = codes[codes.length - 1]?.id;

    for (const code of codes) {
      const actual = code.redeemedCount;
      if (code.currentRedemptions === actual) continue;

      const result = await db.inviteCode.updateMany({
        data: { currentRedemptions: actual },
        where: {
          currentRedemptions: code.currentRedemptions,
          id: code.id,
          redeemedCount: actual,
          slotsChangedAt: code.slotsChangedAt,
        },
      });
      corrected += result.count;
    }

    if (codes.length < BATCH_SIZE) break;
  }

  return { checked, corrected };
}
