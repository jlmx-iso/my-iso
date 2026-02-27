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

import { Avatar } from "~/app/_components/Avatar";
import PageHeader from "~/app/_components/PageHeader";
import { api } from "~/trpc/react";

export default function Page() {
  const utils = api.useUtils();
  const { data: inviteCode, isLoading, error } = api.invite.getMyCode.useQuery();
  const { mutate: regenerate, isPending: isRegenerating } =
    api.invite.regenerate.useMutation({
      onSuccess: () => utils.invite.getMyCode.invalidate(),
    });
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  if (isLoading) {
    return (
      <Stack gap="lg">
        <PageHeader title="Invite Friends" description="Loading your invite code..." />
        <Stack align="center" py="xl">
          <Loader size="sm" />
        </Stack>
      </Stack>
    );
  }

  if (error || !inviteCode) {
    return (
      <Stack gap="lg">
        <PageHeader title="Invite Friends" />
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Could not load invite code">
          {error?.message ?? "No invite code found. Please try refreshing the page."}
        </Alert>
      </Stack>
    );
  }

  const remaining = inviteCode.maxRedemptions - inviteCode.currentRedemptions;
  const progressPct = (inviteCode.currentRedemptions / inviteCode.maxRedemptions) * 100;
  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/join?code=${inviteCode.code}`
      : `/join?code=${inviteCode.code}`;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Invite Friends"
        description="Share your invite code with photographers you know"
      />

      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="md">
          <Text size="sm" c="dimmed">
            Your invite code
          </Text>
          <Title
            order={2}
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
                  {copied ? "Copied!" : "Copy Code"}
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
                  {copied ? "Copied!" : "Copy Link"}
                </Button>
              )}
            </CopyButton>
          </Group>

          <Box w="100%" maw={300}>
            <Group justify="space-between" mb={4}>
              <Text size="xs" c="dimmed">
                {inviteCode.currentRedemptions} of {inviteCode.maxRedemptions} used
              </Text>
              <Text size="xs" fw={500}>
                {remaining} remaining
              </Text>
            </Group>
            <Progress value={progressPct} size="sm" color="orange" />
          </Box>

          <Tooltip label="Generate a new code (keeps your redemption count)">
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
                  {new Date(r.redeemedAt).toLocaleDateString()}
                </Text>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
