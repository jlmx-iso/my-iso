// Access control in front of the ChatRoom Durable Object. Runs in the Worker
// entry (worker.ts) and is type-checked via tsconfig.worker.json.

import { REALTIME_EXPIRES_HEADER, REALTIME_USER_HEADER } from "./chatRoomPolicy";
import type { CloudflareEnv } from "../../cloudflare-env";

export const REALTIME_PATH = "/api/messages/ws";

/** Thread ids are Prisma cuids; anything else never reaches D1 or the DO. */
const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** A signed-in caller: who they are and when their session ends. */
export type RealtimeIdentity = {
  /** Unix milliseconds at which the session expires. */
  expiresAt: number;
  userId: string;
};

/** Resolves the signed-in user from the request, or null. */
export type Authenticate = (request: Request) => Promise<RealtimeIdentity | null>;

function reject(status: number, message: string): Response {
  return new Response(message, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

/**
 * `_MessageThreadToUser` is Prisma's implicit many-to-many join table for
 * MessageThread.participants: column A is the thread id, B the user id.
 */
async function isParticipant(
  db: CloudflareEnv["DB"],
  threadId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT 1 FROM "_MessageThreadToUser" WHERE "A" = ?1 AND "B" = ?2 LIMIT 1',
    )
    .bind(threadId, userId)
    .first();
  return row !== null;
}

/**
 * Handles a request to REALTIME_PATH: only a signed-in participant of the
 * thread, connecting from the app's own origin, is handed to the thread's
 * ChatRoom.
 *
 * Every check also runs for plain (non-upgrade) GET requests, which end in
 * 426. The browser WebSocket API hides the HTTP status of a failed handshake,
 * so the client probes with a plain request to tell "not allowed" (401/403)
 * apart from a transient failure.
 */
export async function handleRealtimeRequest(
  request: Request,
  env: CloudflareEnv,
  authenticate: Authenticate,
): Promise<Response> {
  if (request.method !== "GET") {
    return reject(405, "Method not allowed");
  }

  const url = new URL(request.url);

  // Browsers always send Origin on WebSocket handshakes and cookies ride
  // along regardless of the initiating site, so a foreign origin is refused.
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== url.origin) {
    return reject(403, "Forbidden origin");
  }

  const threadId = url.searchParams.get("threadId");
  if (!threadId || !THREAD_ID_PATTERN.test(threadId)) {
    return reject(400, "Invalid threadId parameter");
  }

  const identity = await authenticate(request);
  if (!identity || identity.expiresAt <= Date.now()) {
    return reject(401, "Unauthorized");
  }
  const { expiresAt, userId } = identity;

  let allowed: boolean;
  try {
    allowed = await isParticipant(env.DB, threadId, userId);
  } catch (error) {
    console.error("Realtime participant check failed", error);
    return reject(503, "Service unavailable");
  }
  if (!allowed) {
    return reject(403, "Not a participant of this thread");
  }

  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return reject(426, "Expected WebSocket upgrade");
  }

  // Hand over a bare upgrade request: the room has no use for the caller's
  // cookies or any other header. It does get who is connecting and until
  // when, to cap sockets per user and to close them when the session ends.
  const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(threadId));
  return stub.fetch(url.toString(), {
    headers: {
      [REALTIME_EXPIRES_HEADER]: String(expiresAt),
      [REALTIME_USER_HEADER]: userId,
      Upgrade: "websocket",
    },
  });
}
