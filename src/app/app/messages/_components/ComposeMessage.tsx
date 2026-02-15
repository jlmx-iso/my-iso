"use client";

import { ActionIcon, Group, Textarea } from "@mantine/core";
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
  const utils = api.useUtils();
  const createMessageThreadMutation = api.message.createThread.useMutation({
    onSuccess: () => {
      void utils.message.getThreadsByUserId.invalidate();
    },
  });
  const createMessageMutation = api.message.create.useMutation({
    onSuccess: () => {
      if ("threadId" in props) {
        void utils.message.getThreadById.invalidate({ threadId: props.threadId });
      }
    },
  });
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
    if (form.validate().hasErrors) return;
    const content = form.values.text.trim();
    if (!content) return;

    if ("threadId" in props) {
      createMessageMutation.mutate({ content, threadId: props.threadId });
    } else {
      createMessageThreadMutation.mutate({ initialMessage: content, participants: [props.recipient.id] });
    }
    form.reset();
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Group
        gap="xs"
        align="end"
        wrap="nowrap"
        pt="sm"
        style={{
          borderTop: "1px solid var(--mantine-color-gray-3)",
        }}
      >
        <Textarea
          {...form.getInputProps("text")}
          style={{ flex: 1 }}
          aria-label="Create a new message"
          onKeyDown={getHotkeyHandler([
            ["mod+Enter", handleSubmit],
          ])}
          placeholder="Type a message..."
          autosize
          minRows={1}
          maxRows={4}
        />
        <ActionIcon
          onClick={handleSubmit}
          variant="filled"
          size="lg"
          radius="xl"
          mb={1}
        >
          <IconSend size={18} />
        </ActionIcon>
      </Group>
    </form>
  );
}
