"use client";

import { ActionIcon, Group, Text, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconSend } from "@tabler/icons-react";
import { type KeyboardEvent, useId, useRef } from "react";

import { MAX_MESSAGE_LENGTH } from "~/_utils/limits";
import { type ThreadMessage } from "~/_utils/threadMessages";
import { userFacingError } from "~/_utils/userError";
import { api } from "~/trpc/react";

import Icebreakers from "./Icebreakers";
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
  /** Offer conversation starters above the box (a match nobody has written in yet). */
  suggestStarters?: boolean;
};

const SEND_FAILED = "Your message wasn't sent. It's still here — please try again.";
/** The counter appears once a message is this close to the limit. */
const COUNTER_FROM = MAX_MESSAGE_LENGTH - 500;

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
        if (value.trim().length > MAX_MESSAGE_LENGTH) {
          return `That message is ${value.trim().length - MAX_MESSAGE_LENGTH} characters over the ${MAX_MESSAGE_LENGTH.toLocaleString("en-US")} limit. Shorten it or split it in two.`;
        }
        return null;
      },
    },
  });

  const isPending = createMessageMutation.isPending || createMessageThreadMutation.isPending;

  const statusId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const setDraft = (text: string) => {
    form.setFieldValue("text", text);
    form.clearFieldError("text");
    inputRef.current?.focus();
  };
  const length = form.values.text.trim().length;
  const error = typeof form.errors.text === "string" ? form.errors.text : null;

  // The draft stays in the input until the server confirms, so a failed send
  // loses nothing.
  const handleSubmit = () => {
    if (isPending) return;
    if (form.validate().hasErrors) return;
    const content = form.values.text.trim();
    // Says why: over the daily limit for new conversations, a person who
    // cannot be messaged, sending too fast (with the wait), too long...
    const onError = (failure: unknown) => form.setFieldError("text", userFacingError(failure, SEND_FAILED));

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
      {"threadId" in props && props.suggestStarters && (
        <Icebreakers threadId={props.threadId} onPick={setDraft} />
      )}
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
          ref={inputRef}
          // The message itself is shown below, full width, under the row.
          error={!!error}
          aria-describedby={statusId}
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
          size={44}
          radius="xl"
          loading={isPending}
          aria-label="Send message"
        >
          <IconSend size={18} />
        </ActionIcon>
      </Group>
      {/* Always rendered so screen readers announce errors as they appear. */}
      <Group id={statusId} justify="space-between" align="flex-start" gap="xs" wrap="nowrap" mt={error || length >= COUNTER_FROM ? 4 : 0}>
        <Text size="sm" c="red" role="alert" data-testid="compose-error" style={{ flex: 1 }}>
          {error}
        </Text>
        {length >= COUNTER_FROM && (
          <Text size="xs" c={length > MAX_MESSAGE_LENGTH ? "red" : "dimmed"} style={{ whiteSpace: "nowrap" }} data-testid="compose-counter">
            {length.toLocaleString("en-US")}/{MAX_MESSAGE_LENGTH.toLocaleString("en-US")}
          </Text>
        )}
      </Group>
    </form>
  );
}
