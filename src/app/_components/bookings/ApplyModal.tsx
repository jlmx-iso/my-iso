"use client";

import {
  Button,
  Modal,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconSend } from "@tabler/icons-react";
import { useState } from "react";

import { logger } from "~/_utils";
import { api } from "~/trpc/react";

import { applyButtonState, type ApplicationStatus } from "./applyButton";

type ApplyModalProps = {
  eventId: string;
  eventTitle: string;
  hasApplied: boolean;
  /** From booking.hasApplied: the application was withdrawn and may be sent again. */
  canReapply?: boolean;
  /** From booking.hasApplied: why the event takes no applications now, if it does not. */
  applyBlockedBy?: ApplicationStatus["applyBlockedBy"];
  onSuccess?: () => void;
};

export default function ApplyModal({
  eventId,
  eventTitle,
  hasApplied,
  canReapply = false,
  applyBlockedBy = null,
  onSuccess,
}: ApplyModalProps) {
  const button = applyButtonState({ applyBlockedBy, canReapply, hasApplied });
  const [opened, { open, close }] = useDisclosure(false);
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");

  const utils = api.useUtils();

  const { mutate, isPending } = api.booking.applyToEvent.useMutation({
    onError: (error) => {
      logger.error("Error applying to event", { error });
      notifications.show({
        color: "red",
        message: error.message ?? "Something went wrong. Please try again.",
        title: "Application Failed",
      });
      // A refusal means this button was out of date (the event filled or
      // started meanwhile): show what the server says now.
      void utils.booking.hasApplied.invalidate({ eventId });
    },
    onSuccess: () => {
      notifications.show({
        color: "teal",
        icon: <IconCheck size={16} />,
        message: "Your application has been sent to the event owner.",
        title: "Application Sent",
      });
      void utils.booking.hasApplied.invalidate({ eventId });
      void utils.booking.getMyApplications.invalidate();
      setRate("");
      setNotes("");
      close();
      onSuccess?.();
    },
  });

  const handleSubmit = () => {
    mutate({
      eventId,
      notes: notes.trim() || undefined,
      rate: rate.trim() || undefined,
    });
  };

  if (button.kind === "disabled") {
    return (
      <Button
        size="xs"
        variant="light"
        color={button.label === "Applied" ? "teal" : "gray"}
        leftSection={button.label === "Applied" ? <IconCheck size={14} /> : undefined}
        disabled
      >
        {button.label}
      </Button>
    );
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={close}
        title={`Apply to "${eventTitle}"`}
        size="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Let the event owner know you are interested in second shooting this
            event. You can include your rate and a message.
          </Text>

          <TextInput
            label="Your Rate"
            placeholder="e.g. $50/hr, $200 flat, negotiable"
            value={rate}
            onChange={(e) => setRate(e.currentTarget.value)}
            maxLength={100}
          />

          <Textarea
            label="Notes"
            placeholder="Introduce yourself, share relevant experience, or ask questions about the event..."
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            maxLength={500}
            autosize
            minRows={3}
            maxRows={6}
          />

          <Button
            onClick={handleSubmit}
            loading={isPending}
            leftSection={<IconSend size={16} />}
          >
            Send Application
          </Button>
        </Stack>
      </Modal>

      <Button size="xs" variant="light" onClick={open}>
        {button.label}
      </Button>
    </>
  );
}
