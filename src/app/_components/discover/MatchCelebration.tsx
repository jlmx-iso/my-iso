"use client";

import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { IconHeartFilled, IconMessageCircle } from "@tabler/icons-react";
import Link from "next/link";

import { Avatar } from "../Avatar";

interface MatchCelebrationProps {
  onClose: () => void;
  threadId: string;
  otherUserName: string;
  otherUserAvatar?: string | null;
  currentUserAvatar?: string | null;
}

/** Dialog shown when a like is mutual. Render it only while there is a match to show. */
export default function MatchCelebration({
  onClose,
  threadId,
  otherUserName,
  otherUserAvatar,
  currentUserAvatar,
}: MatchCelebrationProps) {
  return (
    <Modal
      opened
      onClose={onClose}
      title="It's a match!"
      centered
      size="sm"
      overlayProps={{ backgroundOpacity: 0.7, blur: 4 }}
      radius="lg"
      closeButtonProps={{ "aria-label": "Close and keep swiping" }}
      styles={{
        title: {
          color: "var(--mantine-color-orange-7)",
          fontSize: "var(--mantine-h2-font-size)",
          fontWeight: 700,
        },
      }}
    >
      <Stack align="center" gap="lg" pb="sm">
        <Group gap="lg" justify="center" wrap="nowrap" aria-hidden>
          <Avatar src={currentUserAvatar} name="You" alt="" size={80} />
          <IconHeartFilled size={36} color="var(--mantine-color-red-6)" />
          <Avatar src={otherUserAvatar} name={otherUserName} alt="" size={80} />
        </Group>

        <Text ta="center">
          You and <strong>{otherUserName}</strong> liked each other. Say hello while it&apos;s fresh.
        </Text>

        <Stack w="100%" gap="sm">
          <Button
            fullWidth
            component={Link}
            href={`/app/messages/${threadId}`}
            leftSection={<IconMessageCircle size={18} />}
            data-autofocus
          >
            Send a message
          </Button>
          <Button fullWidth variant="default" onClick={onClose}>
            Keep swiping
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
