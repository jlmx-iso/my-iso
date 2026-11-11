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

/**
 * Validate the session cookie by forwarding a lightweight request to the
 * OpenNext worker (which runs Next.js and has access to Auth.js).  We hit
 * the /api/auth/session endpoint — if the response contains a user id the
 * cookie is valid.
 */
async function validateSession(
  request: Request,
  env: CloudflareEnv,
  ctx: ExecutionContext,
): Promise<string | null> {
  try {
    const cookie = request.headers.get("Cookie");
    if (!cookie) return null;

    const sessionReq = new Request(new URL("/api/auth/session", request.url), {
      headers: { Cookie: cookie },
    });
    const res = await openNextWorker.fetch(sessionReq, env, ctx);
    if (!res.ok) return null;

    const data = (await res.json()) as { user?: { id?: string } };
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

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
      if (!threadId) {
        return new Response("Missing threadId parameter", { status: 400 });
      }

      // Authenticate the request before allowing WebSocket upgrade
      const userId = await validateSession(request, env, ctx);
      if (!userId) {
        return new Response("Unauthorized", { status: 401 });
      }

      const id = env.CHAT_ROOM.idFromName(threadId);
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }

    // All other requests go through the OpenNext Next.js worker
    return openNextWorker.fetch(request, env, ctx);
  },
};
