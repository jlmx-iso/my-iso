import type { DurableObjectNamespace, Rpc } from "@cloudflare/workers-types";

/**
 * RPC surface of the ChatRoom Durable Object, which implements this interface
 * (src/do/ChatRoom.ts). It lives apart from the class so that the Next.js app
 * can type its calls into a room without compiling Worker-only code.
 */
export interface ChatRoomRpc extends Rpc.DurableObjectBranded {
  /** Sends `payload` to every socket in the room. */
  broadcast(payload: string): Promise<void>;
}

export type ChatRoomNamespace = DurableObjectNamespace<ChatRoomRpc>;
