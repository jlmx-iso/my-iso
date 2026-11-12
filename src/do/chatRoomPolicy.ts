// Connection rules of the ChatRoom Durable Object, kept free of Workers-only
// imports so they can be unit-tested (ChatRoom.ts itself imports
// "cloudflare:workers" and only loads inside workerd).

/** Open sockets one user may hold in one room (tabs, devices). */
export const MAX_SOCKETS_PER_USER = 5;

/** Open sockets in one room, whoever holds them. */
export const MAX_SOCKETS_PER_ROOM = 64;

/**
 * Set by the gateway (worker.ts / realtimeGateway.ts) on the internal upgrade
 * request, after it has authenticated the caller. A room is only reachable
 * through the Worker's Durable Object binding, never from the internet, so
 * these headers cannot be supplied by a client.
 */
export const REALTIME_USER_HEADER = "X-Realtime-User";
export const REALTIME_EXPIRES_HEADER = "X-Realtime-Session-Expires";

/** Close code sent when the session a socket was opened with has run out. */
export const CLOSE_SESSION_EXPIRED = 4401;

/** Close code sent when the account a socket belongs to has been deleted. */
export const CLOSE_ACCOUNT_DELETED = 4403;

/**
 * Closes every socket in `sockets` with `code`; returns how many. A socket
 * that is already closed is skipped.
 */
export function closeSockets(sockets: Iterable<{ close(code: number, reason: string): void }>, code: number, reason: string): number {
  let closed = 0;
  for (const socket of sockets) {
    try {
      socket.close(code, reason);
      closed += 1;
    } catch {
      // Already closed.
    }
  }
  return closed;
}

/** Stored on each socket (survives hibernation). */
export type SocketAttachment = {
  /** Unix milliseconds at which the user's session expires. */
  expiresAt: number;
  userId: string;
};

export type ConnectionDecision =
  | { attachment: SocketAttachment; ok: true }
  | { message: string; ok: false; status: number };

/** Hibernation tag that groups one user's sockets. */
export function userTag(userId: string): string {
  return `user:${userId}`;
}

/** Validates the identity the gateway attached to an upgrade request. */
export function readConnection(headers: Headers, nowMs: number): ConnectionDecision {
  const userId = headers.get(REALTIME_USER_HEADER);
  const expiresAt = Number(headers.get(REALTIME_EXPIRES_HEADER));

  if (!userId || userId.length > 128 || !Number.isFinite(expiresAt)) {
    return { message: "Missing connection identity", ok: false, status: 400 };
  }
  if (expiresAt <= nowMs) {
    return { message: "Session expired", ok: false, status: 401 };
  }
  return { attachment: { expiresAt, userId }, ok: true };
}

/** Whether a new socket fits within the per-user and per-room caps. */
export function admitSocket(counts: { room: number; user: number }): ConnectionDecision | null {
  if (counts.user >= MAX_SOCKETS_PER_USER || counts.room >= MAX_SOCKETS_PER_ROOM) {
    return { message: "Too many connections", ok: false, status: 429 };
  }
  return null;
}

export function isSocketAttachment(value: unknown): value is SocketAttachment {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.userId === "string" && typeof candidate.expiresAt === "number";
}

/**
 * Splits sockets into those whose session has expired (to close now) and the
 * time the next one will. A socket without a readable attachment is treated
 * as expired: nothing vouches for it.
 */
export function partitionByExpiry<T>(
  sockets: readonly T[],
  attachmentOf: (socket: T) => unknown,
  nowMs: number,
): { expired: T[]; nextExpiry: number | null } {
  const expired: T[] = [];
  let nextExpiry: number | null = null;

  for (const socket of sockets) {
    const attachment = attachmentOf(socket);
    if (!isSocketAttachment(attachment) || attachment.expiresAt <= nowMs) {
      expired.push(socket);
    } else if (nextExpiry === null || attachment.expiresAt < nextExpiry) {
      nextExpiry = attachment.expiresAt;
    }
  }

  return { expired, nextExpiry };
}
