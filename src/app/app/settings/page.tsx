import {
  Badge,
  Container,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconCheck,
  IconCrown,
  IconSearch,
  IconChartBar,
  IconCalendarEvent,
  IconMessageCircle,
  IconStar,
  IconShieldCheck,
} from "@tabler/icons-react";

import BillingActions from "./_components/BillingActions";
import PageHeader from "~/app/_components/PageHeader";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

const PRO_FEATURES = [
  {
    icon: IconCalendarEvent,
    title: "Unlimited Bookings",
    description: "Accept unlimited second shooter booking requests",
  },
  {
    icon: IconSearch,
    title: "Priority Search Placement",
    description: "Appear higher in search results for potential clients",
  },
  {
    icon: IconChartBar,
    title: "Analytics Dashboard",
    description: "Track profile views, booking rates, and engagement",
  },
  {
    icon: IconMessageCircle,
    title: "Unlimited Messages",
    description: "Send and receive unlimited direct messages",
  },
  {
    icon: IconStar,
    title: "Featured Profile Badge",
    description: "Stand out with a Pro badge on your profile",
  },
  {
    icon: IconShieldCheck,
    title: "Priority Support",
    description: "Get faster responses from our support team",
  },
];

const FREE_FEATURES = [
  "Create a photographer profile",
  "Browse events and opportunities",
  "Send up to 10 messages per month",
  "Apply to 3 bookings per month",
];

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const caller = await api();
  const subscription = await caller.subscription.getStatus();

  const isProUser = subscription?.isActive === true;
  const isCanceled = subscription?.isCanceled === true;

  return (
    <Container size="md" py="lg">
      <Stack gap="xl">
        <PageHeader
          title="Settings"
          description="Manage your subscription and billing"
        />

        {/* Current Plan Status */}
        <Paper withBorder p="xl" radius="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap="xs">
              <Group gap="sm">
                <Title order={3}>Current Plan</Title>
                <Badge
                  color={isProUser ? "orange" : "gray"}
                  variant={isProUser ? "filled" : "light"}
                  size="lg"
                >
                  {isProUser ? "Pro" : "Free"}
                </Badge>
              </Group>
              {isProUser && !isCanceled && (
                <Text size="sm" c="dimmed">
                  Your Pro subscription is active. You have access to all Pro features.
                </Text>
              )}
              {isProUser && isCanceled && (
                <Text size="sm" c="orange">
                  Your subscription is canceled but remains active until{" "}
                  {subscription.expiresAt
                    ? new Date(subscription.expiresAt).toLocaleDateString()
                    : "the end of your billing period"}
                  .
                </Text>
              )}
              {!isProUser && (
                <Text size="sm" c="dimmed">
                  You are on the free plan. Upgrade to Pro to unlock all features.
                </Text>
              )}
            </Stack>
            <BillingActions isProUser={isProUser} />
          </Group>
        </Paper>

        {/* Plan Comparison */}
        <Stack gap="md">
          <Title order={3}>Plan Comparison</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            {/* Free Plan */}
            <Paper withBorder p="lg" radius="md">
              <Stack gap="md">
                <Group gap="sm">
                  <Title order={4}>Free</Title>
                  {!isProUser && (
                    <Badge color="gray" variant="light">
                      Current
                    </Badge>
                  )}
                </Group>
                <Text size="xl" fw={700}>
                  $0
                  <Text span size="sm" fw={400} c="dimmed">
                    /month
                  </Text>
                </Text>
                <Stack gap="xs">
                  {FREE_FEATURES.map((feature) => (
                    <Group key={feature} gap="xs" wrap="nowrap">
                      <ThemeIcon size={20} radius="xl" variant="light" color="gray">
                        <IconCheck size={12} />
                      </ThemeIcon>
                      <Text size="sm">{feature}</Text>
                    </Group>
                  ))}
                </Stack>
              </Stack>
            </Paper>

            {/* Pro Plan */}
            <Paper
              withBorder
              p="lg"
              radius="md"
              style={{
                borderColor: "var(--mantine-color-orange-4)",
                borderWidth: 2,
              }}
            >
              <Stack gap="md">
                <Group gap="sm">
                  <Title order={4}>Pro</Title>
                  {isProUser ? (
                    <Badge color="orange" variant="filled" leftSection={<IconCrown size={12} />}>
                      Current
                    </Badge>
                  ) : (
                    <Badge color="orange" variant="filled" leftSection={<IconCrown size={12} />}>
                      Recommended
                    </Badge>
                  )}
                </Group>
                <Text size="xl" fw={700} c="orange.6">
                  $10
                  <Text span size="sm" fw={400} c="dimmed">
                    /month
                  </Text>
                </Text>
                <Stack gap="xs">
                  {PRO_FEATURES.map((feature) => (
                    <Group key={feature.title} gap="xs" wrap="nowrap">
                      <ThemeIcon size={20} radius="xl" variant="light" color="orange">
                        <IconCheck size={12} />
                      </ThemeIcon>
                      <Text size="sm">{feature.title}</Text>
                    </Group>
                  ))}
                </Stack>
              </Stack>
            </Paper>
          </SimpleGrid>
        </Stack>

        {/* Pro Features Detail */}
        <Stack gap="md">
          <Title order={3}>Pro Features</Title>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
            {PRO_FEATURES.map((feature) => (
              <Paper key={feature.title} withBorder p="lg" radius="md">
                <Stack gap="sm">
                  <ThemeIcon size={40} radius="md" variant="light" color="orange">
                    <feature.icon size={20} />
                  </ThemeIcon>
                  <Text fw={500}>{feature.title}</Text>
                  <Text size="sm" c="dimmed">
                    {feature.description}
                  </Text>
                </Stack>
              </Paper>
            ))}
          </SimpleGrid>
        </Stack>
      </Stack>
    </Container>
  );
}
