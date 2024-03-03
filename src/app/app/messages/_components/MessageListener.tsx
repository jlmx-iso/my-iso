"use client";
import { useState } from "react";
import { messageSub } from "../_utils";
import { type Message } from "@prisma/client";
import MessageTile from "./MessageTile";

export default function MessageListener({ threadId, userId }: { threadId: string; userId: string; }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const messageReceived = (payload: {new: Message}) => {
    setMessages((messages) => [...messages, (payload as {new: Message}).new]);
  };

  messageSub({ threadId, cb: messageReceived });

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <div className="flex flex-col items-center justify-center gap-4">
        <div className="text-2xl">
          {// eslint-disable-next-line 
            messages.map((message) => <MessageTile key={message.id} message={{ ...message, isAuthor: userId === message.senderId }} />
          )}
        </div>
      </div>
    </div>
  )

};