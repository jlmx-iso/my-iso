import type { ExecutionContext, IncomingRequestCfProperties } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import { logger } from "~/_utils";
import type { ThreadMessage } from "~/_utils/threadMessages";

import { captureServerException } from "./posthog";

/** Frame pushed to every socket of a thread's ChatRoom. */
export type ThreadMessageEvent = {
  message: Omit<ThreadMessage, "createdAt"> & { createdAt: string };
  type: "message";
};

function getContext() {
  try {
    return getCloudflareContext<IncomingRequestCfProperties, ExecutionContext>();
  } catch {
    // Not running on Cloudflare (`next dev`, `next start`, tests).
    return null;
  }
}

/**
 * Pushes a new message to everyone who has the thread open.
 *
 * Best effort by design: delivery runs after the response (waitUntil), a
 * failure is logged and never reaches the caller, and without the CHAT_ROOM
 * binding this is a no-op. Clients recover anything they missed by refetching
 * the thread.
 */
export function publishThreadMessage(threadId: string, message: ThreadMessage): void {
  const context = getContext();
  const chatRooms = context?.env.CHAT_ROOM;
  if (!context || !chatRooms) return;

  const event: ThreadMessageEvent = {
    message: { ...message, createdAt: message.createdAt.toISOString() },
    type: "message",
  };

  try {
    const room = chatRooms.get(chatRooms.idFromName(threadId));
    context.ctx.waitUntil(
      room.broadcast(JSON.stringify(event)).catch((error: unknown) => {
        logger.error("Failed to broadcast message to ChatRoom", { error, threadId });
        captureServerException(error, { extra: { threadId }, source: "realtime" });
      }),
    );
  } catch (error) {
    logger.error("Failed to reach ChatRoom", { error, threadId });
  }
}
