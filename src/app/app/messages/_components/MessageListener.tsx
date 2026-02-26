"use client";

import { useCallback, useEffect, useState } from "react";

import { useMessageWebSocket, type WsMessage } from "~/app/_hooks/useMessageWebSocket";

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

  const { messages } = useMessageWebSocket({ threadId, onMessage });
  const [decrypted, setDecrypted] = useState<DecryptedWsMessage[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function decryptAll() {
      const results = await Promise.all(
        messages.map(async (msg) => {
          const content = msg.isEncrypted
            ? await decryptMessage(threadId, msg.content)
            : msg.content;
          return {
            id: msg.id,
            content,
            senderId: msg.senderId,
            createdAt: new Date(msg.createdAt),
            isAuthor: userId === msg.senderId,
          };
        }),
      );
      if (!cancelled) setDecrypted(results);
    }

    void decryptAll();
    return () => { cancelled = true; };
  }, [messages, threadId, userId, decryptMessage]);

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
