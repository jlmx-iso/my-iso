"use client";

import { ActionIcon, Flex, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { getHotkeyHandler } from "@mantine/hooks";
import { IconSend } from "@tabler/icons-react";

import { type Recipient } from "./NewMessageModal";

import { api } from "~/trpc/react";

type ComposeMessageProps = {
  recipient: Recipient;
} | {
  threadId: string;
};

export default function ComposeMessage(props: ComposeMessageProps) {
  const createMessageThreadMutation = api.message.createThread.useMutation();
  const createMessageMutation = api.message.create.useMutation();
  const form = useForm({
    initialValues: {
      text: "",
    },
    validate: {
      text: (value: string) => {
        if (value.trim().length < 1) {
          return "Message must be at least 1 character long";
        }
      }
    }
  });

  const handleSubmit = () => {
    if ("threadId" in props) {
      createMessageMutation.mutate({ content: form.values.text, threadId: props.threadId });
    }
    if ("recipient" in props) {
      createMessageThreadMutation.mutate({ initialMessage: form.values.text, participants: [props.recipient.id] });
    }
    form.reset();
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Flex h="100%" w="100%" pos="relative" wrap="nowrap" style={{ border: "1px solid #ccc", borderRadius: "4px", verticalAlign: "middle" }}>
        <Textarea
          {...form.getInputProps("text")}
          w="100%"
          aria-label="Create a new message"
          onKeyDown={getHotkeyHandler([
            ["mod+Enter", handleSubmit],
          ])}
          placeholder="Create a new message..."
          variant="unstyled"
        />
        <ActionIcon onClick={handleSubmit} pos="absolute" variant="subtle" right={12} top={12}><IconSend /></ActionIcon>
      </Flex>
    </form>
  );
};