import {
  Badge,
  Button,
  Container,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconChartBar, IconCheck, IconCrown } from "@tabler/icons-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { parseCheckoutReturn } from "~/_utils/checkoutStatus";
import { FREE_PLAN, PRO_PLAN, proPriceView } from "~/_utils/plans";
import { hasProAccess } from "~/_utils/subscriptionView";
import { NextLink } from "~/app/_components/NextLink";
import PageHeader from "~/app/_components/PageHeader";
import ProFeatures from "~/app/_components/plans/ProFeatures";
import SupportCard from "~/app/_components/support/SupportCard";
import { auth } from "~/auth";
import { canSendDeletionEmail } from "~/server/_lib/account/deletionDeps";
import { getPricingForRole } from "~/server/_utils/pricing";
import { api } from "~/trpc/server";

import AccountDataSettings from "./_components/AccountDataSettings";
import CheckoutBanner from "./_components/CheckoutBanner";
import PlanStatus from "./_components/PlanStatus";

export const metadata: Metadata = { title: "Settings" };

type PageProps = {
  searchParams: Promise<{ checkout?: string | string[] }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/app/settings");
  const checkout = parseCheckoutReturn((await searchParams).checkout);

  const caller = await api();
  const [subscription, user] = await Promise.all([
    caller.subscription.getStatus(),
    caller.user.getMe(),
  ]);

  const isProUser = hasProAccess(subscription);
  // The server's prices for this member's role; never a number written here.
  const pricing = getPricingForRole(user.role);
  const proPrice = proPriceView(pricing, "monthly");

  return (
    <Container size="md" py="lg" px={0}>
      <Stack gap="xl">
        <PageHeader
          title="Settings"
          description="Manage your subscription and billing"
        />

        {/* One block: the banner's live region is always in the page, and
            must not take a gap of its own while it is empty. */}
        <div>
          {/* Keyed so a new return from checkout restarts the confirmation. */}
          <CheckoutBanner key={checkout ?? "none"} checkout={checkout} isSubscriptionActive={isProUser} />
          <PlanStatus subscription={subscription} pricing={pricing} />
        </div>

        {/* Plan Comparison */}
        <Stack gap="md">
          <Title order={2} size="h4">Plan comparison</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            {/* Free Plan */}
            <Paper withBorder p="lg" radius="md">
              <Stack gap="md">
                <Group gap="sm">
                  <Title order={3} size="h5">{FREE_PLAN.name}</Title>
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
                  <Title order={3} size="h5">{PRO_PLAN.name}</Title>
                  {isProUser ? (
                    <Badge color="orange" variant="filled" leftSection={<IconCrown size={12} aria-hidden />}>
                      Current
                    </Badge>
                  ) : (
                    // Said only when true: the member is on the founding price.
                    pricing.isFoundingPrice && (
                      <Badge color="orange" variant="light" data-testid="founding-badge">
                        Founding member
                      </Badge>
                    )
                  )}
                </Group>
                <Group gap="xs" align="baseline">
                  <Text size="xl" fw={700} c="orange.7" data-testid="pro-price">
                    {proPrice.perMonth}
                    <Text span size="sm" fw={400} c="dimmed">
                      /month
                    </Text>
                  </Text>
                  {proPrice.regularPerMonth && (
                    <>
                      <Text size="sm" td="line-through" c="dimmed">
                        <span className="sr-only">Regular price </span>{proPrice.regularPerMonth}
                      </Text>
                    </>
                  )}
                </Group>
                <ProFeatures pricing={pricing} />
                {isProUser && (
                  <Button
                    component={NextLink}
                    href="/app/insights"
                    variant="light"
                    size="sm"
                    leftSection={<IconChartBar size={16} aria-hidden />}
                    data-testid="view-insights"
                  >
                    View insights
                  </Button>
                )}
              </Stack>
            </Paper>
          </SimpleGrid>
        </Stack>

        <SupportCard isPro={isProUser} replyTo={user.email} />
        <AccountDataSettings
          confirmation={
            user.handle ? { kind: "username", value: user.handle } : { kind: "email", value: user.email }
          }
          confirmationEmail={canSendDeletionEmail()}
        />
      </Stack>
    </Container>
  );
}
