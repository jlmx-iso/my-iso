"use client";

import { Alert, Badge, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconCrown } from "@tabler/icons-react";

import type { PlanPricing } from "~/_utils/plans";
import { type SubscriptionState, subscriptionSummary } from "~/_utils/subscriptionView";
import LocalDate from "~/app/_components/LocalDate";

import BillingActions from "./BillingActions";
import { billingModeFor } from "./billingMode";

type PlanStatusProps = {
  subscription: SubscriptionState | null;
  pricing: PlanPricing;
};

/** Writes `{date}` in the reader's own time zone. */
function withDate(text: string, date: Date | null) {
  const [before, after] = text.split("{date}");
  if (after === undefined || !date) return text.replace("{date}", "the end of the current period");
  return (
    <>
      {before}
      {/* Written in the browser, in the reader's time zone (not the server's). */}
      <time dateTime={new Date(date).toISOString()} style={{ whiteSpace: "nowrap" }}>
        <LocalDate date={date} format="dateLong" />
      </time>
      {after}
    </>
  );
}

/**
 * The member's plan: what they are on, what happens next and when, and the
 * one billing action that fits (upgrade, manage, or fix a payment). A
 * billing problem is shown first, with its fix.
 */
export default function PlanStatus({ subscription, pricing }: PlanStatusProps) {
  const summary = subscriptionSummary(subscription);
  // Checkout, resubscribe, the portal, or nothing: what the server will accept.
  const mode = billingModeFor(subscription);
  const isPro = summary.planName === "Pro";
  const { banner } = summary;

  return (
    <Stack gap="md">
      {banner && (
        <Alert
          color={banner.tone}
          icon={<IconAlertTriangle size={18} aria-hidden />}
          title={banner.title}
          data-testid="billing-banner"
        >
          <Stack gap="sm" align="flex-start">
            <Text size="sm">{withDate(banner.body, banner.date)}</Text>
            <BillingActions mode="portal" portalLabel={banner.actionLabel} pricing={pricing} portalIsPrimary />
          </Stack>
        </Alert>
      )}

      <Paper withBorder p={{ base: "lg", sm: "xl" }} radius="md" data-testid="plan-status">
        <Group justify="space-between" align="flex-start" gap="lg">
          <Stack gap="xs" style={{ flex: "1 1 260px" }}>
            <Group gap="sm">
              <Title order={2} size="h4">Current plan</Title>
              <Badge
                color={isPro ? "tan" : "gray"}
                variant={isPro ? "filled" : "light"}
                size="lg"
                leftSection={isPro ? <IconCrown size={14} aria-hidden /> : undefined}
                data-testid="current-plan"
              >
                {summary.planName}
              </Badge>
              {summary.planDetail && (
                <Text size="sm" c="var(--iso-text-secondary)" data-testid="plan-detail">
                  {summary.planDetail}
                </Text>
              )}
            </Group>
            <Text size="sm" data-testid="plan-line">
              {withDate(summary.line.text, summary.line.date)}
            </Text>
          </Stack>
          {/* With a banner, its button is the action: one way to do it. */}
          {!banner && (
            <BillingActions
              mode={mode}
              portalLabel={summary.portalLabel}
              pricing={pricing}
              paidUntil={subscription?.accessEndsAt ?? null}
            />
          )}
        </Group>
      </Paper>
    </Stack>
  );
}
