// Real-time message delivery is handled by Cloudflare Durable Objects via WebSocket.
// See: src/app/_hooks/useMessageWebSocket.ts
// The old Supabase postgres_changes subscription has been removed.

export type { WsMessage } from "~/app/_hooks/useMessageWebSocket";
