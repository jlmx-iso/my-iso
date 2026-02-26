// @ts-nocheck
// This file is compiled by wrangler, not Next.js. Type-checking is skipped here
// to avoid conflicts between Workers and Node.js type environments.
// wrangler handles its own TypeScript compilation separately.

import type { CloudflareEnv } from "./cloudflare-env";

// Re-export the ChatRoom Durable Object so wrangler can bind it
export { ChatRoom } from "./src/do/ChatRoom";

// Re-export OpenNext built-in Durable Objects
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

// Import the OpenNext default worker to delegate non-WS requests
import openNextWorker from "./.open-next/worker.js";

export default {
  async fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Intercept WebSocket upgrade requests for the messaging realtime layer
    if (
      url.pathname === "/api/messages/ws" &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    ) {
      const threadId = url.searchParams.get("threadId");
      if (threadId) {
        const id = env.CHAT_ROOM.idFromName(threadId);
        const stub = env.CHAT_ROOM.get(id);
        return stub.fetch(request);
      }
      return new Response("Missing threadId parameter", { status: 400 });
    }

    // All other requests go through the OpenNext Next.js worker
    return openNextWorker.fetch(request, env, ctx);
  },
};
