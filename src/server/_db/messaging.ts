import { Prisma } from "@prisma/client";

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
 * Booking statuses that count as a working relationship between applicant
 * and event owner. Declined and cancelled bookings do not.
 */
export const ACTIVE_BOOKING_STATUSES = ["applied", "pending", "accepted", "completed"];

/**
 * Filter for users who have a relationship with `userId`:
 *
 * - the two matched in Discover, or
 * - there is an active booking between them (see ACTIVE_BOOKING_STATUSES),
 *   in either direction, on an event that has not been deleted, or
 * - they have written to `userId` before (in any thread both are part of).
 */
export function relatedToUser(userId: string): Prisma.UserWhereInput {
  const activeBooking = {
    event: { isDeleted: false },
    isDeleted: false,
    status: { in: ACTIVE_BOOKING_STATUSES },
  };
  return {
    OR: [
      { matchesAsUser1: { some: { user2Id: userId } } },
      { matchesAsUser2: { some: { user1Id: userId } } },
      { bookingsApplied: { some: { ...activeBooking, ownerId: userId } } },
      { bookingsOwned: { some: { ...activeBooking, applicantId: userId } } },
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
 * Filter for the users `userId` may start a conversation with: anyone who is
 * discoverable (they opted in to being found), plus anyone related to
 * `userId` (see relatedToUser), and never `userId` themselves.
 *
 * A member who is not discoverable is therefore unreachable, and invisible
 * in recipient search, to everyone they have no relationship with.
 */
export function messageableBy(userId: string): Prisma.UserWhereInput {
  return {
    AND: [
      { id: { not: userId } },
      { OR: [{ isDiscoverable: true }, relatedToUser(userId)] },
    ],
  };
}

/**
 * Splits `otherIds` into those `userId` may start a conversation with and
 * the rest (not messageable, or no such user; callers must not tell the two
 * apart to the client).
 */
export async function classifyRecipients(
  db: UserDb,
  userId: string,
  otherIds: readonly string[],
): Promise<{ messageable: string[]; notMessageable: string[] }> {
  const ids = [...new Set(otherIds)];
  const allowed = await db.user.findMany({
    select: { id: true },
    where: { AND: [{ id: { in: ids } }, messageableBy(userId)] },
  });

  const allowedIds = new Set(allowed.map((user) => user.id));
  return {
    messageable: ids.filter((id) => allowedIds.has(id)),
    notMessageable: ids.filter((id) => !allowedIds.has(id)),
  };
}

// ── Read state ──────────────────────────────────────────────────────────────
//
// ThreadRead(threadId, userId, lastReadAt): the participant has seen
// everything in the thread up to lastReadAt. A message is unread for a user
// when someone else sent it after that (or the user has no row yet). One row
// per participant, so it works the same for group threads.

type ReadDb = Pick<ExtendedPrismaClient, "$queryRaw" | "threadRead">;

/**
 * Records that `userId` has read `threadId` up to `at`. The caller has
 * checked that they are a participant.
 */
export async function markThreadReadAt(
  db: Pick<ExtendedPrismaClient, "threadRead">,
  threadId: string,
  userId: string,
  at: Date,
): Promise<void> {
  const key = { threadId_userId: { threadId, userId } };
  try {
    await db.threadRead.upsert({
      create: { lastReadAt: at, threadId, userId },
      update: { lastReadAt: at },
      where: key,
    });
  } catch (error) {
    // Two first reads at once: the other request inserted the row.
    if (!isUniqueViolation(error)) throw error;
    await db.threadRead.update({ data: { lastReadAt: at }, where: key });
  }
}

/**
 * Thread ids per unread-count statement. D1 accepts at most 100 bound
 * parameters; a page of the conversation list holds up to 50 threads.
 */
const UNREAD_LOOKUP_CHUNK = 80;

const toCount = (value: number | bigint | null | undefined): number => Number(value ?? 0);

/**
 * Unread messages of `userId` in each of `threadIds`: one grouped statement
 * per UNREAD_LOOKUP_CHUNK threads (never one per thread). Threads without
 * unread messages are absent from the map. The caller passes only threads
 * the user takes part in.
 */
export async function countUnreadByThread(
  db: ReadDb,
  userId: string,
  threadIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let start = 0; start < threadIds.length; start += UNREAD_LOOKUP_CHUNK) {
    const chunk = threadIds.slice(start, start + UNREAD_LOOKUP_CHUNK);
    const rows = await db.$queryRaw<Array<{ threadId: string; unread: number | bigint }>>(Prisma.sql`
      SELECT m."threadId" AS "threadId", COUNT(*) AS "unread"
      FROM "Message" m
      LEFT JOIN "ThreadRead" r ON r."threadId" = m."threadId" AND r."userId" = ${userId}
      WHERE m."threadId" IN (${Prisma.join(chunk)})
        AND m."senderId" <> ${userId}
        AND NOT m."isDeleted"
        AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
      GROUP BY m."threadId"`);
    for (const row of rows) counts.set(row.threadId, toCount(row.unread));
  }
  return counts;
}

/**
 * Totals for the navigation badge: how many of the user's conversations have
 * something unread, and how many messages that is. One statement, driven by
 * the user's participant rows and the (threadId, createdAt) index.
 */
export async function countUnreadTotals(
  db: ReadDb,
  userId: string,
): Promise<{ unreadMessages: number; unreadThreads: number }> {
  const rows = await db.$queryRaw<Array<{ messages: number | bigint; threads: number | bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS "messages", COUNT(DISTINCT m."threadId") AS "threads"
    FROM "_MessageThreadToUser" p
    JOIN "Message" m ON m."threadId" = p."A"
    LEFT JOIN "ThreadRead" r ON r."threadId" = p."A" AND r."userId" = p."B"
    WHERE p."B" = ${userId}
      AND m."senderId" <> ${userId}
      AND NOT m."isDeleted"
      AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")`);
  return {
    unreadMessages: toCount(rows[0]?.messages),
    unreadThreads: toCount(rows[0]?.threads),
  };
}
