// @ts-nocheck
// ChatRoom Durable Object — compiled by wrangler, not Next.js.
// Uses the Hibernation API to keep connections alive across DO sleep cycles.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ChatRoom manages one WebSocket room per message thread.
 * One DO instance per threadId (keyed via CHAT_ROOM.idFromName(threadId)).
 */
export class ChatRoom {
  private readonly ctx: any;

  constructor(ctx: any, _env: unknown) {
    this.ctx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // @ts-expect-error — WebSocketPair is a Cloudflare Workers global
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Hibernation API: the DO can sleep between messages without dropping connections
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    // Server never decrypts or forwards payloads — broadcast is triggered via RPC only
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    ws.close();
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    ws.close(1011, "WebSocket error");
  }

  /** Called via DO RPC from tRPC message.create — broadcasts ciphertext to all connected clients */
  async broadcast(payload: string): Promise<void> {
    const sockets: WebSocket[] = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        // Socket may have already closed; ignore
      }
    }
  }
}
