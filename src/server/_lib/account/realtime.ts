// Ending a deleted account's live chat connections. New connections are
// already refused (the gateway finds no session for the account); this
// closes the ones that are open, in every thread the member is part of.
//
// Thread membership is left as it is: the other side keeps the
// conversation, shown with "Deleted member", and access to a room is
// checked against the session, which no longer exists.

import type { ExecutionContext, IncomingRequestCfProperties } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { ChatRoomNamespace } from "~/types/chatRoom";

/** Rooms contacted at once. */
export const REVOKE_CHUNK = 20;

/** The CHAT_ROOM binding, or null where there is none (`next dev`, tests). */
export function chatRoomBinding(): ChatRoomNamespace | null {
  try {
    return getCloudflareContext<IncomingRequestCfProperties, ExecutionContext>().env.CHAT_ROOM ?? null;
  } catch {
    return null;
  }
}

/**
 * Closes `userId`'s sockets in the rooms of `threadIds`, a chunk of rooms at
 * a time, and waits for every room to answer. Idempotent: a room with no
 * socket of theirs closes nothing. Throws if a room cannot be reached, so
 * the deletion step is retried. Returns how many sockets were closed.
 */
export async function revokeRealtimeAccess(
  userId: string,
  threadIds: readonly string[],
  rooms: ChatRoomNamespace | null = chatRoomBinding(),
): Promise<number> {
  if (!rooms) return 0;
  let closed = 0;
  for (let start = 0; start < threadIds.length; start += REVOKE_CHUNK) {
    const chunk = threadIds.slice(start, start + REVOKE_CHUNK);
    const counts = await Promise.all(
      chunk.map((threadId) => rooms.get(rooms.idFromName(threadId)).revokeUser(userId)),
    );
    closed += counts.reduce((sum, count) => sum + count, 0);
  }
  return closed;
}
