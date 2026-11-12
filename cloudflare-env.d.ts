import type { D1Database, DurableObjectNamespace, Fetcher } from "@cloudflare/workers-types";

import type { ChatRoom } from "./src/do/ChatRoom";

export interface CloudflareEnv {
  ASSETS: Fetcher;
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  DB: D1Database;
}
