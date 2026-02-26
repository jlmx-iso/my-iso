"use client";

import { useEffect, useRef, useState } from "react";

export type WsMessage = {
  id: string;
  content: string;
  senderId: string;
  createdAt: string;
  isEncrypted: boolean;
  preview?: string;
};

type UseMessageWebSocketOptions = {
  threadId: string;
  onMessage?: (msg: WsMessage) => void;
};

export function useMessageWebSocket({ threadId, onMessage }: UseMessageWebSocketOptions) {
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!threadId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/messages/ws?threadId=${encodeURIComponent(threadId)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        setMessages((prev) => [...prev, msg]);
        onMessageRef.current?.(msg);
      } catch {
        // Ignore malformed payloads
      }
    };

    ws.onerror = () => {
      // Connection errors are expected during dev; silently ignore
    };

    return () => {
      ws.close(1000, "Component unmounted");
      wsRef.current = null;
    };
  }, [threadId]);

  return { messages };
}
