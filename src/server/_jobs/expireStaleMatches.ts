import type { ExtendedPrismaClient } from "~/server/_db/softDelete";

type MatchDb = Pick<ExtendedPrismaClient, "match">;

/**
 * When a match is spent: its 72-hour window passed and nobody has written in
 * its conversation. Three places apply the same rule:
 *
 * - `liveMatchFilter` and `isMatchExpired`, at read time, so a match stops
 *   being shown the moment it expires, not when the job next runs;
 * - `expireStaleMatches`, the job that stores "expired".
 *
 * What protects a messaged match is the message itself (an EXISTS on the
 * thread's messages, served by the Message (threadId, createdAt) index),
 * not only the "messaged" status the send path sets: that UPDATE is a
 * separate statement after the message is stored (D1 has no transactions)
 * and can fail. A conversation the pair already had before they matched
 * counts too; they are in touch, which is what the window asks for.
 *
 * Once the job has stored "expired", nothing revives the match. Until it
 * runs (every 15 minutes), a first message after the deadline does.
 */
const THREAD_HAS_MESSAGE = { messageThread: { is: { messages: { some: {} } } } } as const;

/**
 * Whether a match has run out of time. `hasMessage`: whether its thread
 * holds at least one message (see above).
 */
export function isMatchExpired(
  match: { expiresAt: Date | null; status: string },
  now: Date = new Date(),
  hasMessage = false,
): boolean {
  if (match.status === "expired") return true;
  if (hasMessage) return false;
  return match.status === "matched" && match.expiresAt !== null && match.expiresAt < now;
}

/**
 * Prisma filter for matches that are still live at `now`.
 *
 * Written as what a live match is, not as "NOT expired": in SQL a row
 * without `expiresAt` makes `NOT (expiresAt < now AND ...)` unknown, and
 * would silently drop out.
 */
export function liveMatchFilter(now: Date = new Date()) {
  return {
    AND: [
      { status: { not: "expired" } },
      {
        OR: [
          { status: { not: "matched" } },
          { expiresAt: null },
          { expiresAt: { gte: now } },
          THREAD_HAS_MESSAGE,
        ],
      },
    ],
  };
}

/**
 * Records that the match whose conversation is `threadId` has been
 * messaged. Called after a message is stored in that thread. An
 * optimisation for readers, which then need not look at the thread: the
 * message alone already keeps the match live.
 *
 * One conditional UPDATE: only a "matched" match moves (an expired one
 * stays expired), and a repeat changes nothing. Returns whether a match
 * moved.
 */
export async function markMatchMessaged(db: MatchDb, threadId: string): Promise<boolean> {
  const result = await db.match.updateMany({
    data: { status: "messaged" },
    where: { messageThreadId: threadId, status: "matched" },
  });
  return result.count > 0;
}

/**
 * Stores "expired" on matches whose window has passed and whose
 * conversation is empty.
 *
 * Idempotent: one conditional UPDATE; a second run finds nothing left to
 * change.
 */
export async function expireStaleMatches(
  db: MatchDb,
  now: Date = new Date(),
): Promise<{ expired: number }> {
  const result = await db.match.updateMany({
    data: { status: "expired" },
    where: {
      expiresAt: { lt: now },
      NOT: THREAD_HAS_MESSAGE,
      status: "matched",
    },
  });
  return { expired: result.count };
}
