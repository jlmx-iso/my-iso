import type { D1Database, DurableObjectNamespace, Fetcher } from "@cloudflare/workers-types";

export interface CloudflareEnv {
  ASSETS: Fetcher;
  CHAT_ROOM: DurableObjectNamespace;
  DB: D1Database;
}
