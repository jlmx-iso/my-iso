"use client";

import {
  Button,
  Container,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

interface ErrorBoundaryProps {
  error: Error;
  reset: () => void;
}

export default function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  return (
    <Container size="sm" py={80}>
      <Stack align="center" gap="lg">
        <ThemeIcon size={72} radius="xl" variant="light" color="orange">
          <IconAlertTriangle size={36} />
        </ThemeIcon>
        <Title order={2} ta="center">
          Something went wrong
        </Title>
        <Text c="dimmed" ta="center" maw={420} style={{ lineHeight: 1.6 }}>
          An unexpected error occurred. You can try again or head back to the
          home page.
        </Text>
        <Text size="xs" c="dimmed" ta="center" maw={420}>
          {error.message}
        </Text>
        <Group>
          <Button variant="filled" onClick={reset}>
            Try again
          </Button>
          <Button variant="light" component="a" href="/">
            Go home
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}
