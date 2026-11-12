"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useMessageWebSocket } from "~/app/_hooks/useMessageWebSocket";

import MessageTile from "./MessageTile";


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
      const settled = await Promise.allSettled(
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
        const results = settled
          .filter((r): r is PromiseFulfilledResult<DecryptedWsMessage> => r.status === "fulfilled")
          .map((r) => r.value);

        for (const msg of results) {
          decryptedIdsRef.current.add(msg.id);
        }
        if (results.length > 0) {
          setDecrypted((prev) => {
            const merged = [...prev, ...results];
            merged.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            return merged;
          });
        }
      }
    }

    void decryptNew();
    return () => { cancelled = true; };
  }, [messages, threadId, userId, decryptMessage]);

  // Reset when thread changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- must clear together with the decrypted-id ref below
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
