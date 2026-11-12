"use client";

import { Alert, Button, Group, List, Modal, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDownload, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import { userFacingError } from "~/_utils/userError";
import PrivacyChoicesLink from "~/app/_components/consent/PrivacyChoicesLink";
import { notify } from "~/app/_lib/notify";
import { api } from "~/trpc/react";

import classes from "./AccountDataSettings.module.css";

/** Public page shown once the account is gone (no personal data in the URL). */
export const ACCOUNT_DELETED_PATH = "/account-deleted";

/** Toast id of "Download ready", so the delete dialog can clear it. */
const EXPORT_TOAST_ID = "account-export";

/** Offers `data` to the browser as a JSON file. */
export function saveJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type Props = {
  /** What the member types to confirm a deletion: their username, or their email without one. */
  confirmation: { kind: "username" | "email"; value: string };
  /** Whether a confirmation email is sent after a deletion (email is configured). */
  confirmationEmail: boolean;
  /** Where the browser goes once the account is gone; `pending` when a step is still to finish. */
  onDeleted?: (pending: boolean) => void;
  /** Saves the export; replaced in tests. */
  saveFile?: (filename: string, data: unknown) => void;
};

/**
 * Settings → "Privacy and your data": privacy choices, a download of
 * everything ISO stores about the member, and deleting the account.
 */
export default function AccountDataSettings({
  confirmation,
  confirmationEmail,
  // A full load, not a client navigation: nothing of the old session stays.
  onDeleted = (pending) => window.location.replace(pending ? `${ACCOUNT_DELETED_PATH}?pending=1` : ACCOUNT_DELETED_PATH),
  saveFile = saveJsonFile,
}: Props) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const exportData = api.account.exportData.useMutation({
    onError: (error) =>
      notify.error({ message: userFacingError(error, "Please try again in a moment."), title: "Couldn't prepare your data" }),
    onSuccess: (data) => {
      saveFile(`iso-data-${data.generatedAt.slice(0, 10)}.json`, data);
      notify.success({ id: EXPORT_TOAST_ID, message: "Your data was downloaded as a JSON file.", title: "Download ready" });
    },
  });

  const deleteAccount = api.account.deleteAccount.useMutation({
    onSuccess: (result) => onDeleted(result.status === "scheduled"),
  });
  const deleting = deleteAccount.isPending;

  const label = confirmation.kind === "username" ? "your username" : "your email address";
  const matches = typed.trim().replace(/^@/, "").toLowerCase() === confirmation.value.toLowerCase();

  return (
    <Stack gap="md">
      <Title order={2} size="h4">
        Privacy and your data
      </Title>

      <Paper withBorder p="lg" radius="md">
        <Stack gap="xs">
          <Title order={3} size="h5">
            Analytics and session replay
          </Title>
          <Text size="sm" c="dimmed">
            Choose whether ISO may measure how you use the app on this browser.
          </Text>
          <Group>
            <PrivacyChoicesLink variant="button" />
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p="lg" radius="md">
        <Stack gap="xs">
          <Title order={3} size="h5">
            Download your data
          </Title>
          <Text size="sm" c="dimmed">
            A JSON file with everything ISO stores about you: your profile, portfolio, events,
            bookings, the messages you sent, reviews, notifications, your plan and your invites. It
            lists the web address of every photo you uploaded, so you can save them too.
          </Text>
          <Group>
            <Button
              variant="default"
              leftSection={<IconDownload size={16} aria-hidden />}
              loading={exportData.isPending}
              onClick={() => exportData.mutate()}
            >
              Download your data
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p="lg" radius="md" className={classes.danger}>
        <Stack gap="xs">
          <Title order={3} size="h5">
            Delete account
          </Title>
          <Text size="sm" c="dimmed">
            Permanently deletes your account, profile and photos, hides your events, and cancels any
            Pro subscription. This cannot be undone.
          </Text>
          <Group>
            <Button
              color="red"
              variant="outline"
              leftSection={<IconTrash size={16} aria-hidden />}
              onClick={() => {
                setTyped("");
                deleteAccount.reset();
                // The download toast would sit over the dialog on a phone.
                notifications.hide(EXPORT_TOAST_ID);
                setDeleteOpen(true);
              }}
            >
              Delete account
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Modal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        centered
        // While the deletion runs, the dialog stays: it cannot be stopped.
        closeOnEscape={!deleting}
        closeOnClickOutside={!deleting}
        withCloseButton={!deleting}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (matches) deleteAccount.mutate({ confirmation: typed });
          }}
        >
          <Stack gap="md">
            <Text size="sm">This happens right away and cannot be undone:</Text>
            <List size="sm" spacing={4}>
              <List.Item>Your profile, portfolio and photos are deleted, and your events are hidden.</List.Item>
              <List.Item>You&apos;ll be signed out on every device.</List.Item>
              <List.Item>
                Any Pro subscription is cancelled now, with no further charges. The rest of the period
                you&apos;ve paid for is not refunded. To keep Pro until it ends, cancel it under Current plan →
                Manage subscription and delete your account later.
              </List.Item>
              <List.Item>
                Messages you sent stay with the people who received them, from &ldquo;Deleted member&rdquo;.
              </List.Item>
              <List.Item>Your open applications and bookings are cancelled.</List.Item>
              {confirmationEmail && <List.Item>We&apos;ll email you a confirmation.</List.Item>}
            </List>
            <Text size="sm">
              You may want to{" "}
              <Button
                variant="transparent"
                size="compact-sm"
                px={0}
                className={classes.inlineButton}
                loading={exportData.isPending}
                disabled={deleting}
                onClick={() => exportData.mutate()}
              >
                download your data
              </Button>{" "}
              first.
            </Text>
            <TextInput
              label={`Type ${label} to confirm`}
              description={confirmation.value}
              value={typed}
              onChange={(event) => setTyped(event.currentTarget.value)}
              autoComplete="off"
              disabled={deleting}
              data-autofocus
            />
            {deleteAccount.error && (
              <Alert color="red" role="alert" title="Your account was not deleted">
                {userFacingError(deleteAccount.error, "Please try again.")}
              </Alert>
            )}
            <Group justify="flex-end" gap="xs">
              <Button variant="default" disabled={deleting} onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" color="red" disabled={!matches} loading={deleting}>
                Delete my account
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
