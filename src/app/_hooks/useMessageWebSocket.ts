"use client";

import { useEffect, useState } from "react";

import {
  classifyHandshakeFailure,
  REALTIME_PATH,
  reconnectDelay,
} from "~/_utils/realtimeConnection";
import { parseThreadMessageEvent, type ThreadMessage } from "~/_utils/threadMessages";
import { CLOSE_ACCOUNT_DELETED } from "~/do/chatRoomPolicy";

import { useLatestRef } from "./useLatestRef";

/**
 * - `connecting`: first attempt in progress.
 * - `open`: receiving messages.
 * - `reconnecting`: the connection failed or dropped; retrying with backoff.
 * - `denied`: the server refused (signed out, not a participant, or the
 *   account was deleted); stopped.
 * - `unavailable`: this deployment has no realtime endpoint; stopped.
 */
export type RealtimeStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "denied"
  | "unavailable";

type UseMessageWebSocketOptions = {
  /** Called for every message pushed to the thread. */
  onMessage: (message: ThreadMessage) => void;
  /**
   * Called each time a connection is established, including reconnects.
   * Messages sent while there was no connection are not replayed, so this is
   * the moment to refetch the thread.
   */
  onOpen?: () => void;
  threadId: string;
};

const CLOSE_NORMAL = 1000;

/**
 * Give up on a handshake that has not completed by then. Some servers never
 * answer an upgrade they do not handle (the Next.js server, for one), which
 * would otherwise leave the socket connecting forever.
 */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Subscribes to a thread's realtime messages for as long as it is mounted. */
export function useMessageWebSocket({
  onMessage,
  onOpen,
  threadId,
}: UseMessageWebSocketOptions): RealtimeStatus {
  const [state, setState] = useState<{ status: RealtimeStatus; threadId: string }>({
    status: "connecting",
    threadId,
  });
  const onMessageRef = useLatestRef(onMessage);
  const onOpenRef = useLatestRef(onOpen);

  useEffect(() => {
    const query = `?threadId=${encodeURIComponent(threadId)}`;
    const probe = new AbortController();
    let disposed = false;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;

    const setStatus = (status: RealtimeStatus) => setState({ status, threadId });

    function scheduleReconnect() {
      setStatus("reconnecting");
      retryTimer = setTimeout(connect, reconnectDelay(attempt));
      attempt += 1;
    }

    /** Asks the endpoint why the handshake failed (see the gateway). */
    async function probeStatus(): Promise<number | null> {
      try {
        const response = await fetch(`${REALTIME_PATH}${query}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: probe.signal,
        });
        return response.status;
      } catch {
        return null;
      }
    }

    async function handleFailedHandshake() {
      const failure = classifyHandshakeFailure(await probeStatus());
      if (disposed) return;

      if (failure === "retry") {
        scheduleReconnect();
      } else {
        setStatus(failure);
      }
    }

    function connect() {
      if (disposed) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}${REALTIME_PATH}${query}`);
      let opened = false;
      socket = ws;
      handshakeTimer = setTimeout(() => ws.close(), HANDSHAKE_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(handshakeTimer);
        opened = true;
        attempt = 0;
        setStatus("open");
        onOpenRef.current?.();
      };

      ws.onmessage = (event: MessageEvent<unknown>) => {
        const message = parseThreadMessageEvent(event.data);
        if (message) onMessageRef.current(message);
      };

      // A failed attempt fires `error` and then `close`; `close` handles both.
      ws.onclose = (event: CloseEvent) => {
        clearTimeout(handshakeTimer);
        if (disposed) return;
        socket = null;

        // The account was deleted: no session will let it back in, so stop
        // here instead of reconnecting to be refused. (An expired session,
        // CLOSE_SESSION_EXPIRED, is retried: the session may have been
        // renewed meanwhile, and the probe tells.)
        if (event.code === CLOSE_ACCOUNT_DELETED) {
          setStatus("denied");
          return;
        }

        if (opened) {
          scheduleReconnect();
        } else {
          void handleFailedHandshake();
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(handshakeTimer);
      probe.abort();
      socket?.close(CLOSE_NORMAL, "Unmounted");
    };
  }, [threadId, onMessageRef, onOpenRef]);

  // Until the effect for a new thread has reported, that thread is connecting.
  return state.threadId === threadId ? state.status : "connecting";
}
