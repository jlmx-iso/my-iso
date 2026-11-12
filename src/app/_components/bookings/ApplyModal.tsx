"use client";

import {
  Alert,
  Button,
  Modal,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAlertCircle, IconSend } from "@tabler/icons-react";
import { type FormEvent, useState } from "react";

import { logger } from "~/_utils/logger";
import { isClientError, userFacingError } from "~/_utils/userError";
import { notify } from "~/app/_lib/notify";
import { api } from "~/trpc/react";

type ApplyModalProps = {
  eventId: string;
  eventTitle: string;
  /** The trigger's text: "Apply", "Apply again". */
  label: string;
  /** Detail page: the trigger is the page's primary action, full width on phones. */
  prominent?: boolean;
  onSuccess?: () => void;
};

export default function ApplyModal({
  eventId,
  eventTitle,
  label,
  prominent = false,
  onSuccess,
}: ApplyModalProps) {
  const [opened, { open, close }] = useDisclosure(false);
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");

  const utils = api.useUtils();

  const { mutate, isPending, error, reset } = api.booking.applyToEvent.useMutation({
    onError: (error) => {
      logger.error("Error applying to event", { error });
      // Refused because of how things stand now (already applied, filled,
      // started): the card behind this dialog should say so too.
      if (isClientError(error)) void utils.booking.hasApplied.invalidate({ eventId });
    },
    onSuccess: () => {
      notify.success({
        message: "Your application has been sent to the event owner.",
        title: "Application sent",
      });
      void utils.booking.hasApplied.invalidate({ eventId });
      void utils.booking.getMyApplicationsPage.invalidate();
      void utils.booking.getMyApplications.invalidate();
      setRate("");
      setNotes("");
      close();
      onSuccess?.();
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutate({
      eventId,
      notes: notes.trim() || undefined,
      rate: rate.trim() || undefined,
    });
  };

  return (
    <>
      <Modal
        opened={opened}
        onClose={() => {
          close();
          reset();
        }}
        title={`Apply to "${eventTitle}"`}
        size="md"
      >
        <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Let the event owner know you are interested in second shooting this
            event. You can include your rate and a message.
          </Text>

          {/* In the dialog, next to what it is about: a toast would sit on
              top of the dialog's title. Always rendered so it is announced. */}
          <div role="alert">
            {error && (
              <Alert color="red" icon={<IconAlertCircle size={16} />} title="Application not sent" data-testid="apply-error">
                {userFacingError(error, "Your application couldn't be sent. Please try again.")}
              </Alert>
            )}
          </div>

          <TextInput
            label="Your rate"
            description="Optional"
            placeholder="e.g. $50/hr, $200 flat, negotiable"
            value={rate}
            onChange={(e) => setRate(e.currentTarget.value)}
            maxLength={100}
          />

          <Textarea
            label="Notes"
            description="Optional"
            placeholder="Introduce yourself, share relevant experience, or ask questions about the event..."
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            maxLength={500}
            autosize
            minRows={3}
            maxRows={6}
          />

          <Button
            type="submit"
            loading={isPending}
            leftSection={<IconSend size={16} />}
          >
            Send application
          </Button>
        </Stack>
        </form>
      </Modal>

      <Button
        size={prominent ? "md" : "sm"}
        w={prominent ? { base: "100%", xs: "auto" } : undefined}
        onClick={open}
        data-testid="apply-button"
      >
        {label}
      </Button>
    </>
  );
}
