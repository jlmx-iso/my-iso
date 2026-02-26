"use client";

import { ActionIcon, Group, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { getHotkeyHandler } from "@mantine/hooks";
import { IconSend } from "@tabler/icons-react";
import { useCallback } from "react";

import { type Recipient } from "./NewMessageModal";

import { useE2EE } from "~/app/_hooks/useE2EE";
import { api } from "~/trpc/react";

type ComposeMessageProps = {
  recipient: Recipient;
} | {
  threadId: string;
};

export default function ComposeMessage(props: ComposeMessageProps) {
  const utils = api.useUtils();
  const { encryptForThread, ready: e2eeReady } = useE2EE();

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

  const getUserPublicKey = useCallback(
    async (userId: string): Promise<JsonWebKey | null> => {
      return utils.client.keys.getUserPublicKey.query({ userId });
    },
    [utils],
  );

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

  const handleSubmit = useCallback(async () => {
    if (form.validate().hasErrors) return;
    const plaintext = form.values.text.trim();
    if (!plaintext) return;

    if ("threadId" in props) {
      if (e2eeReady) {
        // Thread key already exists in IDB — just encrypt and send
        try {
          const { ciphertext, preview } = await encryptForThread(props.threadId, plaintext, []);
          createMessageMutation.mutate({
            content: ciphertext,
            isEncrypted: true,
            preview,
            threadId: props.threadId,
          });
        } catch {
          // Fall back to plaintext if encryption fails
          createMessageMutation.mutate({ content: plaintext, threadId: props.threadId });
        }
      } else {
        createMessageMutation.mutate({ content: plaintext, threadId: props.threadId });
      }
    } else {
      if (e2eeReady) {
        // New thread — fetch recipient public key and wrap thread key for all participants
        try {
          const recipientJwk = await getUserPublicKey(props.recipient.id);
          // We'll also wrap for self — getCurrentUserId + getUserPublicKey
          const selfIdResult = await utils.client.keys.getCurrentUserId.query();
          const selfJwk = selfIdResult ? await getUserPublicKey(selfIdResult) : null;

          const recipients: { userId: string; jwk: JsonWebKey }[] = [];
          if (recipientJwk) recipients.push({ jwk: recipientJwk, userId: props.recipient.id });
          if (selfJwk && selfIdResult) recipients.push({ jwk: selfJwk, userId: selfIdResult });

          // Use a temporary placeholder threadId for key generation (server assigns real one)
          const tempThreadId = `pending-${props.recipient.id}`;
          const { ciphertext, preview, threadKeys } = await encryptForThread(
            tempThreadId,
            plaintext,
            recipients,
          );

          createMessageThreadMutation.mutate({
            initialMessage: ciphertext,
            isEncrypted: true,
            participants: [props.recipient.id],
            preview,
            threadKeys,
          });
        } catch {
          createMessageThreadMutation.mutate({
            initialMessage: plaintext,
            participants: [props.recipient.id],
          });
        }
      } else {
        createMessageThreadMutation.mutate({
          initialMessage: plaintext,
          participants: [props.recipient.id],
        });
      }
    }

    form.reset();
  }, [form, props, e2eeReady, encryptForThread, createMessageMutation, createMessageThreadMutation, getUserPublicKey, utils]);

  const isPending = createMessageMutation.isPending || createMessageThreadMutation.isPending;

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
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
            ["mod+Enter", () => void handleSubmit()],
          ])}
          placeholder="Type a message..."
          autosize
          minRows={1}
          maxRows={4}
        />
        <ActionIcon
          onClick={() => void handleSubmit()}
          variant="filled"
          size="lg"
          radius="xl"
          mb={1}
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
