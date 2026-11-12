"use client";
import {
  Alert,
  Box,
  Button,
  CopyButton,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconLink,
  IconRefresh,
} from "@tabler/icons-react";

import { formatDate } from "~/_lib/dayjs";
import { userFacingError } from "~/_utils/userError";
import { Avatar } from "~/app/_components/Avatar";
import PageHeader from "~/app/_components/PageHeader";
import { notify } from "~/app/_lib/notify";
import { api } from "~/trpc/react";

export default function Page() {
  const utils = api.useUtils();
  const { data: inviteCode, isLoading, error } = api.invite.getMyCode.useQuery();
  const { mutate: regenerate, isPending: isRegenerating, error: regenerateError } =
    api.invite.regenerate.useMutation({
      // Show the new code at once (keeping the list of people already
      // invited), then confirm against the server.
      onSuccess: (updated) => {
        utils.invite.getMyCode.setData(undefined, (current) => (current ? { ...current, ...updated } : current));
        notify.success({
          message: "Your old code and links no longer work. Share the new one.",
          title: "New invite code ready",
        });
        return utils.invite.getMyCode.invalidate();
      },
    });
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  if (isLoading) {
    return (
      <Stack gap="lg">
        <PageHeader title="Invite friends" description="Loading your invite code…" />
        <Stack align="center" py="xl">
          <Loader size="sm" />
        </Stack>
      </Stack>
    );
  }

  if (error || !inviteCode) {
    return (
      <Stack gap="lg">
        <PageHeader title="Invite friends" />
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Could not load invite code">
          {error
            ? userFacingError(error, "Please try refreshing the page.")
            : "No invite code found. Please try refreshing the page."}
        </Alert>
      </Stack>
    );
  }

  // Invites belong to the member, not to a code: a new code keeps the count.
  const remaining = Math.max(0, inviteCode.maxRedemptions - inviteCode.currentRedemptions);
  const progressPct = Math.min(100, (inviteCode.currentRedemptions / inviteCode.maxRedemptions) * 100);
  const isUsedUp = remaining === 0;
  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/join?code=${inviteCode.code}`
      : `/join?code=${inviteCode.code}`;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Invite friends"
        description="Share your invite code with photographers you know"
      />

      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="md">
          <Text size="sm" c="dimmed">
            Your invite code
          </Text>
          <Title
            order={2}
            aria-label={`Your invite code: ${inviteCode.code}`}
            style={{
              fontFamily: "monospace",
              letterSpacing: 2,
              fontSize: "1.75rem",
            }}
          >
            {inviteCode.code}
          </Title>

          <Group>
            <CopyButton value={inviteCode.code}>
              {({ copied, copy }) => (
                <Button
                  variant="light"
                  leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  onClick={copy}
                  color={copied ? "teal" : "orange"}
                >
                  {copied ? "Copied!" : "Copy code"}
                </Button>
              )}
            </CopyButton>
            <CopyButton value={shareLink}>
              {({ copied, copy }) => (
                <Button
                  variant="light"
                  leftSection={copied ? <IconCheck size={16} /> : <IconLink size={16} />}
                  onClick={copy}
                  color={copied ? "teal" : "orange"}
                >
                  {copied ? "Copied!" : "Copy link"}
                </Button>
              )}
            </CopyButton>
          </Group>

          <Box w="100%" maw={300} data-testid="invite-usage">
            <Group justify="space-between" mb={4}>
              <Text size="xs" c="dimmed">
                {inviteCode.currentRedemptions} of {inviteCode.maxRedemptions} invites used
              </Text>
              <Text size="xs" fw={500}>
                {remaining} left
              </Text>
            </Group>
            <Progress value={progressPct} size="sm" aria-label="Invites used" />
          </Box>

          {isUsedUp && (
            <Alert color="tan" icon={<IconAlertCircle size={16} />} w="100%" maw={420}>
              You&apos;ve used all {inviteCode.maxRedemptions} of your invites, so this code can&apos;t
              bring in anyone else. A new code doesn&apos;t add more invites.
            </Alert>
          )}

          <div role="alert">
            {regenerateError && (
              <Text size="sm" c="red">
                {userFacingError(regenerateError, "We couldn't create a new code. Your current one still works.")}
              </Text>
            )}
          </div>

          <Tooltip label="Replace your code with a new one. Your invites used stay the same.">
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={openConfirm}
              loading={isRegenerating}
            >
              Regenerate code
            </Button>
          </Tooltip>

          <Modal
            opened={confirmOpen}
            onClose={closeConfirm}
            title="Regenerate invite code?"
            centered
            size="sm"
          >
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Your current code will be replaced and any existing invite links will stop working.
                The number of invites you&apos;ve used ({inviteCode.currentRedemptions} of{" "}
                {inviteCode.maxRedemptions}) stays the same.
              </Text>
              <Group justify="flex-end">
                <Button variant="subtle" onClick={closeConfirm}>Cancel</Button>
                <Button
                  color="orange"
                  loading={isRegenerating}
                  onClick={() => { regenerate(); closeConfirm(); }}
                >
                  Yes, regenerate
                </Button>
              </Group>
            </Stack>
          </Modal>
        </Stack>
      </Paper>

      {inviteCode.redemptions.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm">
            People you&apos;ve invited
          </Text>
          <Stack gap="xs">
            {inviteCode.redemptions.map((r) => (
              <Group key={r.id} gap="sm">
                <Avatar
                  src={r.redeemedBy.profilePic}
                  name={`${r.redeemedBy.firstName} ${r.redeemedBy.lastName}`}
                  size="sm"
                />
                <Box style={{ flex: 1 }}>
                  <Text size="sm" fw={500}>
                    {r.redeemedBy.firstName} {r.redeemedBy.lastName}
                  </Text>
                </Box>
                <Text size="xs" c="dimmed">
                  {formatDate(r.redeemedAt)}
                </Text>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
