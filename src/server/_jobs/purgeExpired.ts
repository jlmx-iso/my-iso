import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { purgeViewSeen } from "~/server/_lib/viewCounter";
import { purgeExpiredRateLimits, type RateLimitDb } from "~/server/_utils/rateLimit";

type PurgeDb = Pick<ExtendedPrismaClient, "$executeRaw" | "pendingInviteValidation" | "verificationToken"> &
  RateLimitDb;

/**
 * Deletes rows that only mattered until a deadline that has passed:
 * sign-in codes, pending invite validations, rate-limit counters and the
 * "already counted today" keys of past days (ViewSeen).
 *
 * Idempotent, and four single-parameter DELETE statements however many
 * rows there are. None of these rows is read after it expires, so deleting
 * them changes no behaviour; it keeps the tables from growing for ever.
 */
export async function purgeExpired(
  db: PurgeDb,
  now: Date = new Date(),
): Promise<{ pendingInvites: number; rateLimits: number; verificationTokens: number; viewSeen: number }> {
  const verificationTokens = await db.verificationToken.deleteMany({
    where: { expires: { lt: now } },
  });
  const pendingInvites = await db.pendingInviteValidation.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const rateLimits = await purgeExpiredRateLimits(db, now.getTime());
  const viewSeen = await purgeViewSeen(db, now);

  return {
    pendingInvites: pendingInvites.count,
    rateLimits,
    verificationTokens: verificationTokens.count,
    viewSeen,
  };
}
