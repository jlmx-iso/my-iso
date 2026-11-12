"use client";

import { ActionIcon, Group, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconSend } from "@tabler/icons-react";
import { type KeyboardEvent } from "react";

import { type ThreadMessage } from "~/_utils/threadMessages";
import { api } from "~/trpc/react";

import { type Recipient } from "./NewMessageModal";

type ComposeMessageProps = {
  /**
   * Called with the id of the thread the message went to: a new thread, or
   * the existing one when the two people already had a conversation.
   */
  onThreadCreated: (threadId: string) => void;
  recipient: Recipient;
} | {
  /** Called with the stored message once the server has accepted it. */
  onSent: (message: ThreadMessage) => void;
  threadId: string;
};

const SEND_FAILED = "Message could not be sent. Please try again.";
const MAX_LENGTH = 5000;

/**
 * Enter sends where there is a hardware keyboard (a fine pointer); on touch
 * keyboards Enter stays a line break and the send button sends. Shift+Enter
 * is always a line break, Ctrl/Cmd+Enter always sends.
 */
function shouldSendOnKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return false;
  if (event.metaKey || event.ctrlKey) return true;
  if (event.shiftKey || event.altKey) return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export default function ComposeMessage(props: ComposeMessageProps) {
  const createMessageThreadMutation = api.message.createThread.useMutation();
  const createMessageMutation = api.message.create.useMutation();

  const form = useForm({
    initialValues: {
      text: "",
    },
    validate: {
      text: (value: string) => {
        if (value.trim().length < 1) return "Write a message first";
        if (value.length > MAX_LENGTH) return `Keep messages under ${MAX_LENGTH} characters`;
        return null;
      },
    },
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
        align="flex-end"
        wrap="nowrap"
        pt="sm"
        style={{
          borderTop: "1px solid var(--mantine-color-gray-3)",
        }}
      >
        <Textarea
          {...form.getInputProps("text")}
          style={{ flex: 1 }}
          // 16px text: smaller makes iOS zoom the page on focus.
          size="md"
          aria-label="Message"
          onKeyDown={(event) => {
            if (shouldSendOnKey(event)) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Type a message…"
          autosize
          minRows={1}
          maxRows={4}
        />
        <ActionIcon
          type="submit"
          variant="filled"
          size={42}
          radius="xl"
          loading={isPending}
          aria-label="Send message"
          // Line up with the input, not with the error text under it.
          mb={form.errors.text ? 24 : 0}
        >
          <IconSend size={18} />
        </ActionIcon>
      </Group>
    </form>
  );
}
