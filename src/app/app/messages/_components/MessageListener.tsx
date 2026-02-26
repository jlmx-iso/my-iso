"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import MessageTile from "./MessageTile";

import { useMessageWebSocket, type WsMessage } from "~/app/_hooks/useMessageWebSocket";

type DecryptedWsMessage = {
  id: string;
  content: string;
  senderId: string;
  createdAt: Date;
  isAuthor: boolean;
};

type MessageListenerProps = {
  threadId: string;
  userId: string;
  newMessageCb?: () => void;
  decryptMessage: (threadId: string, ciphertext: string) => Promise<string>;
};

export default function MessageListener({
  threadId,
  userId,
  newMessageCb,
  decryptMessage,
}: MessageListenerProps) {
  const onMessage = useCallback(() => {
    newMessageCb?.();
  }, [newMessageCb]);

  const { messages } = useMessageWebSocket({ onMessage, threadId });
  const [decrypted, setDecrypted] = useState<DecryptedWsMessage[]>([]);
  const decryptedIdsRef = useRef(new Set<string>());

  // Only decrypt newly arrived messages (incremental)
  useEffect(() => {
    let cancelled = false;

    const newMessages = messages.filter((m) => !decryptedIdsRef.current.has(m.id));
    if (newMessages.length === 0) return;

    async function decryptNew() {
      const results = await Promise.all(
        newMessages.map(async (msg) => {
          const content = msg.isEncrypted
            ? await decryptMessage(threadId, msg.content)
            : msg.content;
          return {
            content,
            createdAt: new Date(msg.createdAt),
            id: msg.id,
            isAuthor: userId === msg.senderId,
            senderId: msg.senderId,
          };
        }),
      );
      if (!cancelled) {
        for (const msg of results) {
          decryptedIdsRef.current.add(msg.id);
        }
        setDecrypted((prev) => [...prev, ...results]);
      }
    }

    void decryptNew();
    return () => { cancelled = true; };
  }, [messages, threadId, userId, decryptMessage]);

  // Reset when thread changes
  useEffect(() => {
    setDecrypted([]);
    decryptedIdsRef.current.clear();
  }, [threadId]);

  return (
    <div>
      {decrypted.map((msg) => (
        <MessageTile
          key={msg.id}
          message={msg}
        />
      ))}
    </div>
  );
}
