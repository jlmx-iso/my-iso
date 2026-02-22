"use client";
import { type Message } from "@prisma/client";
import { useCallback, useEffect, useState } from "react";

import { messageSub } from "../_utils";
import MessageTile from "./MessageTile";

type MessageListenerProps = {
  threadId: string;
  userId: string;
  newMessageCb?: () => void;
};

export default function MessageListener({ threadId, userId, newMessageCb }: MessageListenerProps) {
  const [messages, setMessages] = useState<Message[]>([]);

  const onNewMessage = useCallback(() => {
    newMessageCb?.();
  }, [newMessageCb]);

  useEffect(() => {
    const channel = messageSub({
      cb: (payload: { new: Message }) => {
        setMessages((prev) => [...prev, payload.new]);
        onNewMessage();
      },
      threadId,
    });

    return () => {
      void channel.unsubscribe();
    };
  }, [threadId, onNewMessage]);

  return (
    <div>
      {messages.map((message) => (
        <MessageTile
          key={message.id}
          message={{ ...message, isAuthor: userId === message.senderId }}
        />
      ))}
    </div>
  );
}