"use client";

import { ActionIcon, Group, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { getHotkeyHandler } from "@mantine/hooks";
import { IconSend } from "@tabler/icons-react";
import { useCallback } from "react";

import { type Recipient } from "./NewMessageModal";

import { storeThreadKey } from "~/_utils/keystore";
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
    onSuccess: async (newThread) => {
      void utils.message.getThreadsByUserId.invalidate();
      // Remap the thread key from the temporary placeholder to the real thread ID
      if ("recipient" in props && newThread?.id) {
        const { getThreadKey } = await import("~/_utils/keystore");
        const tempThreadId = `pending-${props.recipient.id}`;
        const threadKey = await getThreadKey(tempThreadId);
        if (threadKey) {
          await storeThreadKey(newThread.id, threadKey);
        }
      }
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

  const isPending = createMessageMutation.isPending || createMessageThreadMutation.isPending;

  const handleSubmit = useCallback(async () => {
    if (isPending) return;
    if (form.validate().hasErrors) return;
    const plaintext = form.values.text.trim();
    if (!plaintext) return;

    if ("threadId" in props) {
      if (e2eeReady) {
        try {
          const { ciphertext } = await encryptForThread(props.threadId, plaintext, []);
          createMessageMutation.mutate({
            content: ciphertext,
            isEncrypted: true,
            threadId: props.threadId,
          });
        } catch {
          form.setFieldError("text", "Encryption failed. Message was not sent.");
          return;
        }
      } else {
        createMessageMutation.mutate({ content: plaintext, threadId: props.threadId });
      }
    } else {
      if (e2eeReady) {
        try {
          const recipientJwk = await getUserPublicKey(props.recipient.id);
          const selfIdResult = await utils.client.keys.getCurrentUserId.query();
          const selfJwk = selfIdResult ? await getUserPublicKey(selfIdResult) : null;

          const recipients: { userId: string; jwk: JsonWebKey }[] = [];
          if (recipientJwk) recipients.push({ jwk: recipientJwk, userId: props.recipient.id });
          if (selfJwk && selfIdResult) recipients.push({ jwk: selfJwk, userId: selfIdResult });

          const tempThreadId = `pending-${props.recipient.id}`;
          const { ciphertext, threadKeys } = await encryptForThread(
            tempThreadId,
            plaintext,
            recipients,
          );

          createMessageThreadMutation.mutate({
            initialMessage: ciphertext,
            isEncrypted: true,
            participants: [props.recipient.id],
            threadKeys,
          });
        } catch {
          form.setFieldError("text", "Encryption failed. Message was not sent.");
          return;
        }
      } else {
        createMessageThreadMutation.mutate({
          initialMessage: plaintext,
          participants: [props.recipient.id],
        });
      }
    }

    form.reset();
  }, [form, props, isPending, e2eeReady, encryptForThread, createMessageMutation, createMessageThreadMutation, getUserPublicKey, utils]);

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
