// ChatRoom Durable Object. Bundled by wrangler (see worker.ts), not Next.js,
// and type-checked against the Workers runtime via tsconfig.worker.json.
// Uses the Hibernation API to keep connections alive across DO sleep cycles.

/**
 * ChatRoom manages one WebSocket room per message thread.
 * One DO instance per threadId (keyed via CHAT_ROOM.idFromName(threadId)).
 */
export class ChatRoom {
  private readonly ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

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
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        // Socket may have already closed; ignore
      }
    }
  }
}
