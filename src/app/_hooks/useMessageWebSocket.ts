"use client";

import { useEffect, useRef, useState } from "react";

export type WsMessage = {
  id: string;
  content: string;
  senderId: string;
  createdAt: string;
  isEncrypted: boolean;
};

type UseMessageWebSocketOptions = {
  threadId: string;
  onMessage?: (msg: WsMessage) => void;
};

const MAX_RECONNECT_DELAY = 30_000;

export function useMessageWebSocket({ threadId, onMessage }: UseMessageWebSocketOptions) {
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!threadId) return;

    // Clear stale messages from previous thread
    setMessages([]);

    let cancelled = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      if (cancelled) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/api/messages/ws?threadId=${encodeURIComponent(threadId)}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt = 0;
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as WsMessage;
          setMessages((prev) => [...prev, msg]);
          onMessageRef.current?.(msg);
        } catch {
          // Ignore malformed payloads
        }
      };

      ws.onclose = (event) => {
        if (cancelled) return;
        // Don't reconnect on normal closure (code 1000)
        if (event.code === 1000) return;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onerror is always followed by onclose, so reconnection is handled there
      };
    }

    function scheduleReconnect() {
      if (cancelled) return;
      const delay = Math.min(1000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY);
      reconnectAttempt++;
      reconnectTimer = setTimeout(connect, delay);
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close(1000, "Component unmounted");
      wsRef.current = null;
    };
  }, [threadId]);

  return { messages };
}
