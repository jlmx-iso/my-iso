import { Button, Center, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconMessageOff } from "@tabler/icons-react";

import { NextLink } from "~/app/_components/NextLink";

/** Shown in the thread pane for a thread id that is wrong or not the member's. */
export default function ThreadNotFound() {
  return (
    <Center h="100%" p="md">
      <Stack align="center" gap="md">
        <ThemeIcon size={64} radius="xl" variant="light" color="gray">
          <IconMessageOff size={32} aria-hidden />
        </ThemeIcon>
        <Title order={2} size="h4" ta="center">
          Conversation not found
        </Title>
        <Text c="dimmed" size="sm" ta="center" maw={320}>
          This conversation doesn&apos;t exist, or you&apos;re not part of it.
        </Text>
        <Button component={NextLink} href="/app/messages" variant="default">
          Back to conversations
        </Button>
      </Stack>
    </Center>
  );
}
