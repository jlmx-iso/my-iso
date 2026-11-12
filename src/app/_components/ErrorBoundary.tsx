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
import { useEffect } from "react";

import { logger } from "~/_utils/logger";
import { isNetworkError } from "~/_utils/userError";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Where "Go home" leads. */
  homeHref?: string;
}

/**
 * Route error screen. The underlying message is logged, never shown: it can
 * be a raw server or validation error. The digest lets support find the log.
 */
export default function ErrorBoundary({ error, reset, homeHref = "/" }: ErrorBoundaryProps) {
  useEffect(() => {
    logger.error("Route error boundary", { digest: error.digest, error });
  }, [error]);

  const offline = isNetworkError(error);

  return (
    <Container size="sm" py={80}>
      <Stack align="center" gap="lg" role="alert">
        <ThemeIcon size={72} radius="xl" variant="light" color="orange">
          <IconAlertTriangle size={36} aria-hidden />
        </ThemeIcon>
        <Title order={1} size="h2" ta="center">
          {offline ? "You appear to be offline" : "Something went wrong"}
        </Title>
        <Text c="dimmed" ta="center" maw={420} style={{ lineHeight: 1.6 }}>
          {offline
            ? "We couldn't reach ISO. Check your connection and try again."
            : "That wasn't supposed to happen. Try again, and if it keeps happening, head back and come at it from another page."}
        </Text>
        {error.digest && (
          <Text size="xs" c="dimmed" ta="center">
            Reference: {error.digest}
          </Text>
        )}
        <Group>
          <Button variant="filled" onClick={reset}>
            Try again
          </Button>
          <Button variant="default" component="a" href={homeHref}>
            Go home
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}
