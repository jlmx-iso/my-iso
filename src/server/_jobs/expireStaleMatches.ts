import type { ExtendedPrismaClient } from "~/server/_db/softDelete";

type MatchDb = Pick<ExtendedPrismaClient, "match">;

/**
 * Whether a match has run out of time: nobody messaged before `expiresAt`.
 * Readers apply this themselves, so a match stops being shown the moment it
 * expires, not when the job next runs (the job only tidies the stored
 * status).
 */
export function isMatchExpired(
  match: { expiresAt: Date | null; status: string },
  now: Date = new Date(),
): boolean {
  if (match.status === "expired") return true;
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
        OR: [{ status: { not: "matched" } }, { expiresAt: null }, { expiresAt: { gte: now } }],
      },
    ],
  };
}

/**
 * Marks matches whose window has passed as expired.
 *
 * Idempotent: one conditional UPDATE (two bound parameters); a second run
 * finds nothing left to change.
 */
export async function expireStaleMatches(
  db: MatchDb,
  now: Date = new Date(),
): Promise<{ expired: number }> {
  const result = await db.match.updateMany({
    data: { status: "expired" },
    where: { expiresAt: { lt: now }, status: "matched" },
  });
  return { expired: result.count };
}
