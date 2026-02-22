"use client";

import { Avatar, Button, Group, Modal, Stack, Text, Title } from "@mantine/core";
import { IconHeart, IconMessageCircle } from "@tabler/icons-react";
import { useRouter } from "next/navigation";

interface MatchCelebrationProps {
  opened: boolean;
  onClose: () => void;
  matchId: string;
  threadId: string;
  otherUserName: string;
  otherUserAvatar?: string | null;
  currentUserAvatar?: string | null;
}

export default function MatchCelebration({
  opened,
  onClose,
  threadId,
  otherUserName,
  otherUserAvatar,
  currentUserAvatar,
}: MatchCelebrationProps) {
  const router = useRouter();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      centered
      size="sm"
      overlayProps={{ backgroundOpacity: 0.7, blur: 4 }}
      radius="lg"
    >
      <Stack align="center" gap="lg" py="lg">
        <Group gap="xl" justify="center">
          <Avatar src={currentUserAvatar} size={80} radius="xl" color="orange" />
          <IconHeart size={40} color="var(--mantine-color-red-5)" fill="var(--mantine-color-red-5)" />
          <Avatar src={otherUserAvatar} size={80} radius="xl" color="orange">
            {otherUserName[0]}
          </Avatar>
        </Group>

        <Stack align="center" gap={4}>
          <Title order={2} c="orange.7" ta="center">
            It&apos;s a Match!
          </Title>
          <Text c="dimmed" ta="center" size="sm">
            You and {otherUserName} liked each other
          </Text>
        </Stack>

        <Stack w="100%" gap="sm">
          <Button
            fullWidth
            color="orange"
            leftSection={<IconMessageCircle size={18} />}
            onClick={() => {
              onClose();
              router.push(`/app/messages/${threadId}`);
            }}
          >
            Send a Message
          </Button>
          <Button fullWidth variant="light" color="gray" onClick={onClose}>
            Keep Swiping
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
