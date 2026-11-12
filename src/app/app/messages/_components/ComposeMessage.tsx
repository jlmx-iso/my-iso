"use client";

import { ActionIcon, Group, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { getHotkeyHandler } from "@mantine/hooks";
import { IconSend } from "@tabler/icons-react";

import { type ThreadMessage } from "~/_utils/threadMessages";
import { api } from "~/trpc/react";

import { type Recipient } from "./NewMessageModal";

type ComposeMessageProps = {
  /** Called with the new thread's id once the first message is stored. */
  onThreadCreated: (threadId: string) => void;
  recipient: Recipient;
} | {
  /** Called with the stored message once the server has accepted it. */
  onSent: (message: ThreadMessage) => void;
  threadId: string;
};

const SEND_FAILED = "Message could not be sent. Please try again.";

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

  const isPending = createMessageMutation.isPending || createMessageThreadMutation.isPending;

  // The draft stays in the input until the server confirms, so a failed send
  // loses nothing.
  const handleSubmit = () => {
    if (isPending) return;
    if (form.validate().hasErrors) return;
    const content = form.values.text.trim();
    const onError = () => form.setFieldError("text", SEND_FAILED);

    if ("threadId" in props) {
      createMessageMutation.mutate({ content, threadId: props.threadId }, {
        onError,
        onSuccess: ({ content, createdAt, id, sender }) => {
          form.reset();
          props.onSent({ content, createdAt, id, sender });
        },
      });
    } else {
      createMessageThreadMutation.mutate({
        initialMessage: content,
        participants: [props.recipient.id],
      }, {
        onError,
        onSuccess: (thread) => {
          form.reset();
          props.onThreadCreated(thread.id);
        },
      });
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      <Group
        gap="xs"
        align="start"
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
          type="submit"
          variant="filled"
          size="lg"
          radius="xl"
          loading={isPending}
          disabled={isPending}
          aria-label="Send message"
        >
          <IconSend size={18} />
        </ActionIcon>
      </Group>
    </form>
  );
}
