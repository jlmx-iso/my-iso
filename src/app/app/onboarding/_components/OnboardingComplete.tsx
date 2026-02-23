"use client";

import {
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconCalendarEvent,
  IconCamera,
  IconCircleCheck,
  IconSearch,
} from "@tabler/icons-react";

type OnboardingCompleteProps = {
  isPro: boolean;
};

const FIRST_ACTIONS = [
  {
    icon: IconCamera,
    title: "Upload portfolio photos",
    description: "Show leads what you can do",
    href: "/app/profile",
    color: "orange",
  },
  {
    icon: IconSearch,
    title: "Discover photographers",
    description: "Swipe through photographers near you",
    href: "/app/discover",
    color: "blue",
  },
  {
    icon: IconCalendarEvent,
    title: "Post your first event",
    description: "Find a second shooter for an upcoming shoot",
    href: "/app/events",
    color: "green",
  },
];

export function OnboardingComplete({ isPro }: OnboardingCompleteProps) {
  return (
    <Box maw={600} w="100%" mx="auto" py={40}>
      <Stack align="center" gap="xl">
        <ThemeIcon size={80} radius="xl" variant="light" color="orange">
          <IconCircleCheck size={40} />
        </ThemeIcon>

        <Stack align="center" gap="xs">
          <Title order={1} ta="center">
            You&apos;re in! 🎉
          </Title>
          {isPro ? (
            <Text size="lg" c="dimmed" ta="center" maw={420}>
              Welcome to Pro! Your founding member badge is live and your
              price is locked in forever.
            </Text>
          ) : (
            <Text size="lg" c="dimmed" ta="center" maw={420}>
              Your profile is live. You can upgrade to Pro anytime from Settings.
            </Text>
          )}
        </Stack>

        <Stack gap="md" w="100%">
          <Text fw={600} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: 1 }}>
            Here&apos;s what to do first
          </Text>
          {FIRST_ACTIONS.map((action) => (
            <Paper
              key={action.title}
              component="a"
              href={action.href}
              withBorder
              p="md"
              radius="md"
              style={{
                textDecoration: "none",
                cursor: "pointer",
                transition: "border-color 0.15s ease",
              }}
            >
              <Group gap="md">
                <ThemeIcon size={44} radius="md" variant="light" color={action.color}>
                  <action.icon size={22} />
                </ThemeIcon>
                <Stack gap={2}>
                  <Text fw={500} size="sm">{action.title}</Text>
                  <Text size="xs" c="dimmed">{action.description}</Text>
                </Stack>
              </Group>
            </Paper>
          ))}
        </Stack>

        <Button
          component="a"
          href="/app/events"
          variant="subtle"
          color="gray"
          size="sm"
        >
          Go to the app
        </Button>
      </Stack>
    </Box>
  );
}
