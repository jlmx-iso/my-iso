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

import LocalDate from "~/app/_components/LocalDate";
import PageHeader from "~/app/_components/PageHeader";
import { auth } from "~/auth";
import { getPricingForRole } from "~/server/_utils/pricing";
import type { BillingIssue } from "~/server/api/routers/subscription";
import { api } from "~/trpc/server";

import BillingActions from "./_components/BillingActions";
import { billingModeFor } from "./_components/billingMode";

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

/** One line on why a subscription needs attention, next to "Manage Subscription". */
function billingIssueNotice(issue: BillingIssue | null, hasProAccess: boolean): string | null {
  switch (issue) {
    case "payment_failed":
      return hasProAccess
        ? "Your last payment failed. Update your payment method in Manage Subscription to keep Pro."
        : "Your Pro subscription is on hold because a payment failed. Update your payment method in Manage Subscription to restore it.";
    case "paused":
      return "Your Pro subscription is paused. Resume it in Manage Subscription.";
    case "incomplete":
      return "Your first payment has not gone through yet. Complete or retry it in Manage Subscription.";
    case "disputed":
      return "Pro is on hold while a payment dispute is open with your bank. Contact support if this is a mistake.";
    case "unknown_status":
      return "Your subscription needs attention. Open Manage Subscription to review it.";
    case null:
      return null;
  }
}

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const caller = await api();
  const [subscription, user] = await Promise.all([
    caller.subscription.getStatus(),
    caller.user.getMe(),
  ]);

  const isProUser = subscription?.hasProAccess === true;
  const isCanceled = subscription?.isCanceled === true;
  const pricing = getPricingForRole(user.role);

  // A subscription that cannot start a new checkout is managed in the
  // billing portal, WHETHER OR NOT it currently gives Pro access: that is
  // where a failed payment is fixed and a paused or unfinished subscription
  // is resumed or ended. (Offering "Upgrade" there would only be refused.)
  // One that was cancelled outright and still has paid time is offered a
  // new subscription under its real name: see billingModeFor.
  const billingMode = billingModeFor(subscription);
  // Two different things are both "canceled" to the user: a subscription
  // that is still running and set to end (undo it in the portal), and one
  // that has ended with paid time left (only a new one can follow).
  const hasEnded = subscription?.status === "canceled";
  const accessEndsAt = subscription?.accessEndsAt ?? subscription?.expiresAt ?? null;
  const billingNotice = subscription ? billingIssueNotice(subscription.billingIssue, isProUser) : null;

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
              {billingNotice && (
                <Text size="sm" c="red">
                  {billingNotice}
                  {isProUser && subscription?.accessEndsAt && (
                    <>
                      {" "}Pro stays on until{" "}
                      <LocalDate date={new Date(subscription.accessEndsAt).toISOString()} />.
                    </>
                  )}
                </Text>
              )}
              {isProUser && !isCanceled && !billingNotice && (
                <Text size="sm" c="dimmed">
                  Your Pro subscription is active. You have access to all Pro features.
                </Text>
              )}
              {isProUser && isCanceled && (
                <Text size="sm" c="orange">
                  {hasEnded
                    ? "Your subscription has been canceled. You keep Pro until "
                    : "Your subscription is set to cancel and will not renew. You keep Pro until "}
                  {accessEndsAt
                    ? <LocalDate date={new Date(accessEndsAt).toISOString()} />
                    : "the end of your billing period"}
                  {hasEnded ? "." : ". To keep it, undo the cancellation in Manage Subscription."}
                </Text>
              )}
              {!isProUser && !billingNotice && (
                <Text size="sm" c="dimmed">
                  You are on the free plan. Upgrade to Pro to unlock all features.
                </Text>
              )}
            </Stack>
            <BillingActions
              mode={billingMode}
              pricing={pricing}
              paidUntil={billingMode === "resubscribe" && accessEndsAt ? new Date(accessEndsAt).toISOString() : null}
            />
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
                <Group gap="xs" align="baseline">
                  <Text size="xl" fw={700} c="orange.6">
                    ${pricing.monthlyPrice}
                    <Text span size="sm" fw={400} c="dimmed">
                      /month
                    </Text>
                  </Text>
                  {pricing.isFoundingPrice && (
                    <>
                      <Text size="sm" td="line-through" c="dimmed">
                        ${pricing.standardMonthlyPrice}
                      </Text>
                      <Badge color="orange" variant="light" size="sm">
                        Founding Price
                      </Badge>
                    </>
                  )}
                </Group>
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

      </Stack>
    </Container>
  );
}
