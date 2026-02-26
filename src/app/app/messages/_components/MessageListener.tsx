"use client";

import { useCallback } from "react";

import { useMessageWebSocket, type WsMessage } from "~/app/_hooks/useMessageWebSocket";

import MessageTile from "./MessageTile";

type MessageListenerProps = {
  threadId: string;
  userId: string;
  newMessageCb?: () => void;
  decryptMessage?: (msg: WsMessage) => Promise<string> | string;
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

  return (
    <div>
      {messages.map((msg) => {
        // For encrypted messages, content is decrypted by the parent via decryptMessage.
        // Until decryption resolves we show the raw ciphertext (or a placeholder).
        // Actual async decryption is wired in MessageFeed which reads the resolved values.
        const content = !msg.isEncrypted || !decryptMessage
          ? msg.content
          : msg.content; // Parent (MessageFeed) handles decryption via useE2EE

        return (
          <MessageTile
            key={msg.id}
            message={{
              id: msg.id,
              content,
              senderId: msg.senderId,
              createdAt: new Date(msg.createdAt),
              isAuthor: userId === msg.senderId,
            }}
          />
        );
      })}
    </div>
  );
}
