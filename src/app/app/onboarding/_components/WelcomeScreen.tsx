"use client";

import {
  Box,
  Button,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconCamera, IconStar } from "@tabler/icons-react";

const SOCIAL_PROOF_THRESHOLD = 50;

type WelcomeScreenProps = {
  firstName: string;
  onContinue: () => void;
  photographerCount: number;
};

export function WelcomeScreen({ firstName, onContinue, photographerCount }: WelcomeScreenProps) {
  return (
    <Box maw={500} w="100%" mx="auto" py={60}>
      <Stack align="center" gap="xl">
        <ThemeIcon size={80} radius="xl" variant="light" color="orange">
          <IconCamera size={40} />
        </ThemeIcon>

        <Stack align="center" gap="xs">
          <Title order={1} ta="center">
            Welcome to ISO, {firstName}!
          </Title>
          <Text size="lg" c="dimmed" ta="center" maw={400}>
            {photographerCount >= SOCIAL_PROOF_THRESHOLD
              ? `Joining ${photographerCount.toLocaleString()} photographers on ISO.`
              : "You\u2019re one of the first photographers to join the network."}
          </Text>
        </Stack>

        <Box
          p="lg"
          style={{
            background: "var(--mantine-color-orange-0)",
            borderRadius: "var(--mantine-radius-md)",
            width: "100%",
          }}
        >
          <Stack align="center" gap="xs">
            <IconStar size={20} color="var(--mantine-color-orange-6)" />
            <Text size="sm" ta="center" fw={500}>
              As a founding member, you&apos;ll get perks that won&apos;t be
              available later — including a locked-in price that never goes up.
            </Text>
          </Stack>
        </Box>

        <Button size="lg" color="orange" onClick={onContinue} fullWidth>
          Let&apos;s set up your profile
        </Button>
      </Stack>
    </Box>
  );
}
