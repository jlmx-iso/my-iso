"use client";
import { type Message } from "@prisma/client";
import { useState } from "react";

import { messageSub } from "../_utils";
import MessageTile from "./MessageTile";

type MessageListenerProps = {
  threadId: string;
  userId: string;
  newMessageCb?: () => void;
};

export default function MessageListener({ threadId, userId, newMessageCb }: MessageListenerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const messageReceived = (payload: { new: Message }) => {
    // eslint-disable-next-line
    setMessages((messages) => [...messages, (payload as { new: Message }).new]);
    if (newMessageCb) {
      newMessageCb();
    }
  };

  messageSub({ cb: messageReceived, threadId });

  return (
    <div>
      {// eslint-disable-next-line 
        messages.map((message) => <MessageTile key={message.id} message={{ ...message, isAuthor: userId === message.senderId }} />
        )}
    </div>
  )

};