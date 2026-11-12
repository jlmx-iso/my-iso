// ChatRoom Durable Object. Bundled by wrangler (see worker.ts), not Next.js,
// and type-checked against the Workers runtime via tsconfig.worker.json.

import { DurableObject } from "cloudflare:workers";

import {
  admitSocket,
  CLOSE_SESSION_EXPIRED,
  isSocketAttachment,
  partitionByExpiry,
  readConnection,
  userTag,
} from "./chatRoomPolicy";
import type { CloudflareEnv } from "../../cloudflare-env";
import type { ChatRoomRpc } from "../types/chatRoom";

/**
 * Upper bound for one broadcast frame. A message body is at most 5000
 * characters (see message.create), which stays far below this even when every
 * character is JSON-escaped.
 */
export const MAX_BROADCAST_BYTES = 64 * 1024;

const CLOSE_NORMAL = 1000;
const CLOSE_POLICY_VIOLATION = 1008;

/**
 * One room per message thread (keyed via CHAT_ROOM.idFromName(threadId)).
 *
 * The room is a fan-out only: worker.ts authenticates and authorises the
 * WebSocket upgrade before it reaches this object, and message.create pushes
 * new messages in through `broadcast` (Durable Object RPC). Sockets are
 * accepted with the Hibernation API, so an idle room is evicted from memory
 * and stops accruing duration charges while its connections stay open.
 *
 * Two limits are enforced here because only the room can see its sockets:
 *
 * - at most MAX_SOCKETS_PER_USER per user (and MAX_SOCKETS_PER_ROOM overall),
 *   so one account cannot pile up connections;
 * - a socket lives no longer than the session it was opened with. The gateway
 *   passes the session's expiry along with the upgrade; it is stored on the
 *   socket, and an alarm closes sockets as their sessions run out. A client
 *   that is still signed in simply reconnects.
 */
export class ChatRoom extends DurableObject<CloudflareEnv> implements ChatRoomRpc {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const connection = readConnection(request.headers, Date.now());
    if (!connection.ok) {
      return new Response(connection.message, { status: connection.status });
    }
    const { attachment } = connection;
    const tag = userTag(attachment.userId);

    const refusal = admitSocket({
      room: this.ctx.getWebSockets().length,
      user: this.ctx.getWebSockets(tag).length,
    });
    if (refusal && !refusal.ok) {
      return new Response(refusal.message, { status: refusal.status });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [tag]);
    server.serializeAttachment(attachment);
    await this.scheduleExpiryCheck(attachment.expiresAt);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Runs when the earliest session among the room's sockets expires. */
  async alarm(): Promise<void> {
    const nextExpiry = this.closeExpiredSockets(Date.now());
    if (nextExpiry !== null) {
      await this.ctx.storage.setAlarm(nextExpiry);
    }
  }

  /** Clients only listen. Anything they send is a protocol violation. */
  async webSocketMessage(ws: WebSocket): Promise<void> {
    ws.close(CLOSE_POLICY_VIOLATION, "Client frames are not accepted");
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // Complete the closing handshake. The peer's code may be a reserved one
    // (1005/1006) that cannot be echoed, so always answer with a normal close.
    try {
      ws.close(CLOSE_NORMAL, "Closing");
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "WebSocket error");
    } catch {
      // Already closed.
    }
  }

  /** Called over RPC by message.create (see publishThreadMessage). */
  async broadcast(payload: string): Promise<void> {
    const size = new TextEncoder().encode(payload).byteLength;
    if (size > MAX_BROADCAST_BYTES) {
      throw new RangeError(
        `Broadcast payload is ${size} bytes; the limit is ${MAX_BROADCAST_BYTES}`,
      );
    }

    // Alarms can fire late; never deliver to a socket whose session is over.
    this.closeExpiredSockets(Date.now());

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // The socket closed between getWebSockets() and send().
      }
    }
  }

  /** Closes sockets whose session has expired; returns the next expiry. */
  private closeExpiredSockets(nowMs: number): number | null {
    const { expired, nextExpiry } = partitionByExpiry(
      this.ctx.getWebSockets(),
      (ws) => {
        const attachment: unknown = ws.deserializeAttachment();
        return isSocketAttachment(attachment) ? attachment : null;
      },
      nowMs,
    );

    for (const ws of expired) {
      try {
        ws.close(CLOSE_SESSION_EXPIRED, "Session expired");
      } catch {
        // Already closed.
      }
    }
    return nextExpiry;
  }

  /** Makes sure the alarm fires no later than `expiresAt`. */
  private async scheduleExpiryCheck(expiresAt: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || expiresAt < current) {
      await this.ctx.storage.setAlarm(expiresAt);
    }
  }
}
