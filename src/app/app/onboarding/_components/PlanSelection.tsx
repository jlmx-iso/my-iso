"use client";

import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconCalendarEvent,
  IconCheck,
  IconChartBar,
  IconCrown,
  IconMessageCircle,
  IconSearch,
  IconShieldCheck,
  IconStar,
} from "@tabler/icons-react";
import { useState } from "react";

import type { PricingInfo } from "~/server/_utils/pricing";
import { api } from "~/trpc/react";

type PlanSelectionProps = {
  onSelectFree: () => void;
  pricing: PricingInfo;
};

const PRO_FEATURES = [
  { icon: IconSearch, label: "Priority search placement" },
  { icon: IconMessageCircle, label: "Unlimited messages" },
  { icon: IconCalendarEvent, label: "Unlimited bookings" },
  { icon: IconChartBar, label: "Analytics dashboard" },
  { icon: IconStar, label: "Featured profile badge" },
  { icon: IconShieldCheck, label: "Priority support" },
];

const FREE_LIMITS = [
  "10 swipes per day",
  "3 messages per month",
  "3 applications per month",
  "Basic profile",
];

export function PlanSelection({ pricing, onSelectFree }: PlanSelectionProps) {
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");
  const [error, setError] = useState<string | null>(null);

  const createCheckout = api.subscription.createCheckoutSession.useMutation({
    onError: (err) => {
      setError(err.message ?? "Failed to create checkout session");
    },
    onMutate: () => setError(null),
    onSuccess: (data) => {
      if (data.url) {
        setError(null);
        window.location.href = data.url;
      } else {
        setError("Checkout session created but no redirect URL was returned. Please try again.");
      }
    },
  });

  const monthlyEquivalent = billingInterval === "monthly"
    ? pricing.monthlyPrice
    : Math.round((pricing.annualPrice / 12) * 100) / 100;

  const annualSavings = pricing.monthlyPrice * 12 - pricing.annualPrice;

  return (
    <Box maw={700} w="100%" mx="auto">
      <Stack align="center" gap="lg" mb="xl">
        <Title order={2} ta="center">
          Choose your plan
        </Title>
        <Text c="dimmed" ta="center" maw={500}>
          Start free or unlock everything with Pro.
          {pricing.isFoundingPrice && (
            <> As a founding member, you&apos;ll lock in a price that never goes up.</>
          )}
        </Text>
        <SegmentedControl
          value={billingInterval}
          onChange={(value) => setBillingInterval(value as "monthly" | "annual")}
          data={[
            { label: "Monthly", value: "monthly" },
            { label: "Annual (save more)", value: "annual" },
          ]}
        />
      </Stack>

      <Group grow align="stretch" gap="lg">
        {/* Free Plan */}
        <Paper withBorder p="xl" radius="md">
          <Stack gap="md" h="100%" justify="space-between">
            <Stack gap="md">
              <Title order={3}>Free</Title>
              <Text size="xl" fw={700}>
                $0
                <Text span size="sm" fw={400} c="dimmed">/month</Text>
              </Text>
              <Stack gap="xs">
                {FREE_LIMITS.map((feature) => (
                  <Group key={feature} gap="xs" wrap="nowrap">
                    <ThemeIcon size={20} radius="xl" variant="light" color="gray">
                      <IconCheck size={12} />
                    </ThemeIcon>
                    <Text size="sm">{feature}</Text>
                  </Group>
                ))}
              </Stack>
            </Stack>
            <Button
              variant="light"
              color="gray"
              size="md"
              fullWidth
              onClick={onSelectFree}
            >
              Start Free
            </Button>
          </Stack>
        </Paper>

        {/* Pro Plan */}
        <Paper
          withBorder
          p="xl"
          radius="md"
          style={{
            borderColor: "var(--mantine-color-orange-4)",
            borderWidth: 2,
          }}
        >
          <Stack gap="md" h="100%" justify="space-between">
            <Stack gap="md">
              <Group gap="sm">
                <Title order={3}>Pro</Title>
                <Badge color="orange" variant="filled" leftSection={<IconCrown size={12} />}>
                  Recommended
                </Badge>
              </Group>
              <Group gap="xs" align="baseline">
                <Text size="xl" fw={700} c="orange.6">
                  ${monthlyEquivalent}
                  <Text span size="sm" fw={400} c="dimmed">/mo</Text>
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
              {billingInterval === "annual" && annualSavings > 0 && (
                <Text size="xs" c="green" fw={500}>
                  ${pricing.annualPrice}/yr — save ${annualSavings} vs monthly
                </Text>
              )}
              <Stack gap="xs">
                {PRO_FEATURES.map((feature) => (
                  <Group key={feature.label} gap="xs" wrap="nowrap">
                    <ThemeIcon size={20} radius="xl" variant="light" color="orange">
                      <IconCheck size={12} />
                    </ThemeIcon>
                    <Text size="sm">{feature.label}</Text>
                  </Group>
                ))}
              </Stack>
            </Stack>
            <Stack gap="xs">
              <Button
                color="orange"
                size="md"
                fullWidth
                loading={createCheckout.isPending}
                onClick={() => createCheckout.mutate({ billingInterval, successPath: "/app/onboarding/complete?plan=pro" })}
              >
                Upgrade to Pro — ${monthlyEquivalent}/mo
              </Button>
              {pricing.isFoundingPrice && (
                <Text size="xs" c="dimmed" ta="center">
                  Founding price locked forever
                </Text>
              )}
            </Stack>
          </Stack>
        </Paper>
      </Group>

      {error && (
        <Text size="sm" c="red" ta="center" mt="md">
          {error}
        </Text>
      )}
    </Box>
  );
}
