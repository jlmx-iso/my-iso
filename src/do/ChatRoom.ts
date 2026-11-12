// ChatRoom Durable Object. Bundled by wrangler (see worker.ts), not Next.js,
// and type-checked against the Workers runtime via tsconfig.worker.json.

import { DurableObject } from "cloudflare:workers";

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
 */
export class ChatRoom extends DurableObject<CloudflareEnv> implements ChatRoomRpc {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
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

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // The socket closed between getWebSockets() and send().
      }
    }
  }
}
