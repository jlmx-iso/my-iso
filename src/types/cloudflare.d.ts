import type { ChatRoomNamespace } from "./chatRoom";

declare global {
  /**
   * Bindings of this Worker as seen from the Next.js app through
   * `getCloudflareContext()` (the interface is declared by
   * @opennextjs/cloudflare). Optional because the app also runs without them,
   * under `next dev` and `next start`.
   */
  interface CloudflareEnv {
    CHAT_ROOM?: ChatRoomNamespace;
  }
}
