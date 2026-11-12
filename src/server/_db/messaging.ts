import type { Prisma } from "@prisma/client";

import { isUniqueViolation } from "./errors";
import type { ExtendedPrismaClient } from "./softDelete";

/** Most people one thread may have, the creator included. */
export const MAX_THREAD_PARTICIPANTS = 10;

type ThreadDb = Pick<ExtendedPrismaClient, "messageThread">;
type UserDb = Pick<ExtendedPrismaClient, "user">;

/**
 * Canonical key of a participant set: the distinct ids, sorted, joined with
 * ":" (ids are cuids/uuids and never contain one). Stored in the unique
 * column MessageThread.participantKey, which is what guarantees one thread
 * per set of people without a transaction.
 */
export function threadParticipantKey(participantIds: readonly string[]): string {
  return [...new Set(participantIds)].sort().join(":");
}

/**
 * The thread shared by exactly these participants, or null.
 *
 * Threads created before `participantKey` existed have a null key; they are
 * found by comparing participants and given their key here, so each is
 * matched the slow way at most once.
 */
export async function findThreadByParticipants(
  db: ThreadDb,
  participantIds: readonly string[],
): Promise<{ id: string } | null> {
  const ids = [...new Set(participantIds)];
  const participantKey = threadParticipantKey(ids);

  const keyed = await db.messageThread.findUnique({
    select: { id: true },
    where: { participantKey },
  });
  if (keyed) return keyed;

  const legacy = await db.messageThread.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
    where: {
      AND: ids.map((id) => ({ participants: { some: { id } } })),
      participantKey: null,
      participants: { every: { id: { in: ids } } },
    },
  });
  if (!legacy) return null;

  try {
    await db.messageThread.update({
      data: { participantKey },
      where: { id: legacy.id },
    });
    return legacy;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Another request keyed a thread for this set first: that one wins.
    return db.messageThread.findUnique({
      select: { id: true },
      where: { participantKey },
    });
  }
}

/**
 * Returns the thread for exactly these participants, creating it if needed.
 * Concurrent callers get the same thread: the loser of the insert race hits
 * the unique key and reads the winner's row.
 */
export async function findOrCreateThread(
  db: ThreadDb,
  participantIds: readonly string[],
): Promise<{ created: boolean; id: string }> {
  const ids = [...new Set(participantIds)];
  const existing = await findThreadByParticipants(db, ids);
  if (existing) return { created: false, id: existing.id };

  const participantKey = threadParticipantKey(ids);
  try {
    const thread = await db.messageThread.create({
      data: {
        participantKey,
        participants: { connect: ids.map((id) => ({ id })) },
      },
      select: { id: true },
    });
    return { created: true, id: thread.id };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await db.messageThread.findUnique({
      select: { id: true },
      where: { participantKey },
    });
    if (!winner) throw error;
    return { created: false, id: winner.id };
  }
}

/**
 * Filter for users who already have a relationship with `userId`, which is
 * what allows starting a conversation with them:
 *
 * - the two matched in Discover, or
 * - one applied to the other's event (a booking in either direction), or
 * - they have written to `userId` before (in any thread both are part of).
 */
export function relatedToUser(userId: string): Prisma.UserWhereInput {
  return {
    OR: [
      { matchesAsUser1: { some: { user2Id: userId } } },
      { matchesAsUser2: { some: { user1Id: userId } } },
      { bookingsApplied: { some: { isDeleted: false, ownerId: userId } } },
      { bookingsOwned: { some: { applicantId: userId, isDeleted: false } } },
      {
        messages: {
          some: {
            isDeleted: false,
            thread: { participants: { some: { id: userId } } },
          },
        },
      },
    ],
  };
}

/**
 * Splits `otherIds` into those that exist and are related to `userId`, those
 * that exist but are not, and those that do not exist.
 */
export async function classifyRecipients(
  db: UserDb,
  userId: string,
  otherIds: readonly string[],
): Promise<{ missing: string[]; related: string[]; unrelated: string[] }> {
  const ids = [...new Set(otherIds)];
  const [existing, related] = await Promise.all([
    db.user.findMany({ select: { id: true }, where: { id: { in: ids } } }),
    db.user.findMany({
      select: { id: true },
      where: { AND: [{ id: { in: ids } }, relatedToUser(userId)] },
    }),
  ]);

  const existingIds = new Set(existing.map((user) => user.id));
  const relatedIds = new Set(related.map((user) => user.id));
  return {
    missing: ids.filter((id) => !existingIds.has(id)),
    related: ids.filter((id) => relatedIds.has(id)),
    unrelated: ids.filter((id) => existingIds.has(id) && !relatedIds.has(id)),
  };
}
