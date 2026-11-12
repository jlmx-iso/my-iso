"use client";

import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconCalendarEvent,
  IconCamera,
  IconChevronRight,
  IconCircleCheck,
  IconClock,
  IconSearch,
} from "@tabler/icons-react";
import Link from "next/link";

import { checkoutBannerState } from "~/_utils/checkoutStatus";
import { useSubscriptionConfirmation } from "~/app/_hooks/useSubscriptionConfirmation";

const FIRST_ACTIONS = [
  {
    color: "orange",
    description: "Show leads what you can do",
    href: "/app/profile",
    icon: IconCamera,
    title: "Upload portfolio photos",
  },
  {
    color: "blue",
    description: "Swipe through photographers near you",
    href: "/app/discover",
    icon: IconSearch,
    title: "Discover photographers",
  },
  {
    color: "green",
    description: "Find a second shooter for an upcoming shoot",
    // Opens the create-event modal on the events page.
    href: "/app/events?create=1",
    icon: IconCalendarEvent,
    title: "Post your first event",
  },
];

type OnboardingCompleteProps = {
  /** The member arrived from Stripe Checkout (`?plan=pro`). Not proof of payment. */
  cameFromCheckout: boolean;
  /** Whether the server's subscription record is active. */
  isSubscriptionActive: boolean;
};

export function OnboardingComplete({ cameFromCheckout, isSubscriptionActive }: OnboardingCompleteProps) {
  const { attempts, isActive } = useSubscriptionConfirmation({
    enabled: cameFromCheckout,
    initialIsActive: isSubscriptionActive,
  });
  const checkout = checkoutBannerState({
    attempts,
    checkout: cameFromCheckout ? "success" : null,
    isSubscriptionActive: isActive,
  });

  return (
    <Box maw={600} w="100%" mx="auto" py={{ base: "md", sm: 40 }}>
      <Stack align="center" gap="xl">
        <ThemeIcon size={80} radius="xl" variant="light" color="orange">
          <IconCircleCheck size={40} aria-hidden />
        </ThemeIcon>

        <Stack align="center" gap="xs">
          <Title order={1} ta="center">
            Your profile is ready
          </Title>
          <Text size="lg" c="dimmed" ta="center" maw={440}>
            {isActive
              ? "Welcome to Pro, and thank you for backing ISO this early. Your profile is live."
              : "Your profile is live. You can upgrade to Pro any time from Settings."}
          </Text>
        </Stack>

        {/* Always rendered so screen readers announce the payment status. */}
        <Box w="100%" role="status" data-testid="checkout-status" data-state={checkout}>
          {checkout === "confirming" && (
            <Alert color="blue" icon={<Loader size={18} color="blue" />} title="Confirming your payment…">
              Thanks! We&apos;re activating Pro on your account. This usually takes a few seconds, and
              you can start exploring in the meantime.
            </Alert>
          )}
          {checkout === "delayed" && (
            <Alert color="tan" icon={<IconClock size={18} />} title="Your payment is still being confirmed">
              This is taking longer than usual. You won&apos;t be charged twice. Check{" "}
              <Link href="/app/settings" style={{ textDecoration: "underline" }}>Settings</Link> in a
              minute to see your plan.
            </Alert>
          )}
        </Box>

        <Stack gap="md" w="100%">
          <Title order={2} size="h5">
            Here&apos;s what to do first
          </Title>
          {FIRST_ACTIONS.map((action) => (
            <Paper
              key={action.title}
              component={Link}
              href={action.href}
              className="card-interactive"
              withBorder
              p="md"
              radius="md"
              display="block"
            >
              <Group gap="md" wrap="nowrap">
                <ThemeIcon size={44} radius="md" variant="light" color={action.color}>
                  <action.icon size={22} aria-hidden />
                </ThemeIcon>
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={600} size="sm">{action.title}</Text>
                  <Text size="sm" c="dimmed">{action.description}</Text>
                </Stack>
                <IconChevronRight size={18} color="var(--mantine-color-gray-6)" aria-hidden />
              </Group>
            </Paper>
          ))}
        </Stack>

        <Button component={Link} href="/app/events" variant="default">
          Go to the app
        </Button>
      </Stack>
    </Box>
  );
}
