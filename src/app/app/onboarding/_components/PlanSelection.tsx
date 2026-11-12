"use client";

import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorReason, getErrorReason } from "~/_utils/errorReason";
import { type BillingInterval, formatPrice, FREE_PLAN, type PlanPricing, PRO_PLAN, proPriceView } from "~/_utils/plans";
import { trpcErrorCode, userFacingError } from "~/_utils/userError";
import ProFeatures from "~/app/_components/plans/ProFeatures";
import { api } from "~/trpc/react";

type PlanSelectionProps = {
  /** The server's prices for this member's role. */
  pricing: PlanPricing;
};

export function PlanSelection({ pricing }: PlanSelectionProps) {
  const router = useRouter();
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [error, setError] = useState<string | null>(null);

  const createCheckout = api.subscription.createCheckoutSession.useMutation({
    onError: (err) => {
      if (getErrorReason(err) === ErrorReason.SUBSCRIPTION_EXISTS) {
        // Already subscribed (another tab, or an earlier visit): nothing to buy.
        router.replace("/app/onboarding/complete?plan=pro");
        return;
      }
      if (trpcErrorCode(err) === "CONFLICT") {
        // A second click while the first is still opening checkout.
        setError(null);
        return;
      }
      setError(userFacingError(err, "We couldn't start checkout. You haven't been charged. Please try again, or start free and upgrade later."));
    },
    onMutate: () => setError(null),
    onSuccess: (data) => {
      if (data.url) {
        setError(null);
        window.location.assign(data.url);
      } else {
        setError("We couldn't start checkout. Please try again, or start free and upgrade later.");
      }
    },
  });

  const price = proPriceView(pricing, billingInterval);
  const annual = billingInterval === "annual";
  // What is charged each time: the yearly total for an annual plan.
  const charged = annual ? formatPrice(pricing.annualPrice) : price.perMonth;

  return (
    <Box maw={700} w="100%" mx="auto">
      <Stack align="center" gap="lg" mb="xl">
        <Title order={1} size="h2" ta="center">
          Choose your plan
        </Title>
        <Text c="dimmed" ta="center" maw={500}>
          Start free or unlock everything with Pro.
          {pricing.isFoundingPrice && (
            <> As a founding member you get a lower price, and it stays the same for as long as you stay subscribed.</>
          )}
        </Text>
        <SegmentedControl
          aria-label="Billing interval"
          name="onboarding-billing-interval"
          value={billingInterval}
          onChange={(value) => setBillingInterval(value === "annual" ? "annual" : "monthly")}
          data={[
            { label: "Monthly", value: "monthly" },
            { label: "Annual (save more)", value: "annual" },
          ]}
        />
      </Stack>

      {/* One column on phones, side by side from the `sm` breakpoint. */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        {/* Free Plan */}
        <Paper withBorder p="xl" radius="md">
          <Stack gap="md" h="100%" justify="space-between">
            <Stack gap="md">
              <Title order={2} size="h4">{FREE_PLAN.name}</Title>
              <Text size="xl" fw={700}>
                $0
                <Text span size="sm" fw={400} c="dimmed">/month</Text>
              </Text>
              <Stack gap="xs">
                {FREE_PLAN.features.map((feature) => (
                  <Group key={feature} gap="xs" wrap="nowrap">
                    <ThemeIcon size={20} radius="xl" variant="light" color="gray">
                      <IconCheck size={12} aria-hidden />
                    </ThemeIcon>
                    <Text size="sm">{feature}</Text>
                  </Group>
                ))}
              </Stack>
            </Stack>
            <Button
              component={Link}
              href="/app/onboarding/complete"
              variant="default"
              size="md"
              fullWidth
            >
              Start free
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
                <Title order={2} size="h4">{PRO_PLAN.name}</Title>
                {pricing.isFoundingPrice && (
                  <Badge color="orange" variant="light" data-testid="founding-badge">
                    Founding member
                  </Badge>
                )}
              </Group>
              <Group gap="xs" align="baseline">
                <Text size="xl" fw={700} c="orange.7" data-testid="pro-price">
                  {charged}
                  <Text span size="sm" fw={400} c="dimmed">{annual ? "/year" : "/month"}</Text>
                </Text>
                {annual && (
                  <Text size="sm" c="dimmed">
                    ({price.perMonth}/month)
                  </Text>
                )}
                {price.regularPerMonth && (
                  <>
                    <Text size="sm" td="line-through" c="dimmed">
                      <span className="sr-only">Regular price </span>{price.regularPerMonth}
                    </Text>
                  </>
                )}
              </Group>
              {price.annualNote && (
                <Text size="xs" c="gray.7" fw={500}>
                  {price.annualNote}
                </Text>
              )}
              <ProFeatures pricing={pricing} />
            </Stack>
            <Stack gap="xs">
              <Button
                size="md"
                fullWidth
                loading={createCheckout.isPending}
                onClick={() => createCheckout.mutate({ billingInterval, successPath: "/app/onboarding/complete?plan=pro" })}
              >
                {annual ? `Upgrade to Pro — ${charged}/year` : price.cta}
              </Button>
              <Text size="xs" c="dimmed" ta="center" data-testid="renewal-terms">
                Renews automatically every {annual ? "year" : "month"} at {charged} until you cancel. Cancel anytime
                in Settings → Billing.
              </Text>
              {pricing.isFoundingPrice && (
                <Text size="xs" c="dimmed" ta="center">
                  Your founding price stays while you stay subscribed
                </Text>
              )}
            </Stack>
          </Stack>
        </Paper>
      </SimpleGrid>

      <div role="alert">
        {error && (
          <Text size="sm" c="red" ta="center" mt="md">
            {error}
          </Text>
        )}
      </div>
    </Box>
  );
}
