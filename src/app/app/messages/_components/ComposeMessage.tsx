"use client";

import { TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";

import { api } from "~/trpc/react";

export default function ComposeMessage({ userId, threadId }: { userId: string, threadId: string; }) {
  const createMessageMutation = api.message.create.useMutation();
  const form = useForm({
    initialValues: {
      text: "",
    },
    validate: {
      text: (value) => {
        if (value.trim().length < 1) {
          return "Message must be at least 1 character long";
        }
      }
    }
  });

  return (
  <form onSubmit={form.onSubmit((values) => {
    createMessageMutation.mutate({ content: values.text, threadId, userId });
    values.text = "";
  })}>
    <TextInput aria-label="Create a new message" placeholder="Create a new message..." {...form.getInputProps("text")} disabled={createMessageMutation.isLoading} />
    <button type="submit">Send</button>
    </form>
  );
};