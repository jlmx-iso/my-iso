"use client";

import { Button, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconCreditCard, IconExternalLink } from "@tabler/icons-react";
import { useState } from "react";

import { ErrorReason, getErrorReason } from "~/_utils";
import type { PricingInfo } from "~/server/_utils/pricing";
import { api } from "~/trpc/react";

type BillingActionsProps = {
  /**
   * "portal": there is a subscription that is managed in the Stripe billing
   * portal (running, or lapsed: unpaid, paused, incomplete). "checkout":
   * a new subscription can be started. "none": a comped account.
   */
  mode: "checkout" | "portal" | "none";
  pricing: PricingInfo;
};

export default function BillingActions({ mode, pricing }: BillingActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");
  // The server found a subscription this page did not know about (it
  // refreshes from Stripe when checkout starts): offer the portal instead.
  const [subscriptionExists, setSubscriptionExists] = useState(false);

  const createCheckout = api.subscription.createCheckoutSession.useMutation({
    onError: (err) => {
      if (getErrorReason(err) === ErrorReason.SUBSCRIPTION_EXISTS) setSubscriptionExists(true);
      setError(err.message ?? "Failed to create checkout session");
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
  });

  const createPortal = api.subscription.createPortalSession.useMutation({
    onError: (err) => {
      setError(err.message ?? "Failed to create portal session");
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
  });

  const monthlyEquivalent = billingInterval === "monthly"
    ? pricing.monthlyPrice
    : Math.round((pricing.annualPrice / 12) * 100) / 100;

  const annualSavings = pricing.monthlyPrice * 12 - pricing.annualPrice;

  if (mode === "none") return null;

  if (mode === "portal" || subscriptionExists) {
    return (
      <Stack gap="xs">
        <Button
          onClick={() => createPortal.mutate()}
          loading={createPortal.isPending}
          leftSection={<IconCreditCard size={18} />}
          rightSection={<IconExternalLink size={14} />}
          variant="light"
          color="orange"
          size="md"
        >
          Manage Subscription
        </Button>
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
      </Stack>
    );
  }

  return (
    <Stack gap="xs" align="flex-end">
      <SegmentedControl
        value={billingInterval}
        onChange={(value) => setBillingInterval(value)}
        data={[
          { label: "Monthly", value: "monthly" },
          { label: "Annual", value: "annual" },
        ]}
        size="xs"
      />
      <Button
        onClick={() => createCheckout.mutate({ billingInterval })}
        loading={createCheckout.isPending}
        leftSection={<IconCreditCard size={18} />}
        color="orange"
        size="md"
      >
        Upgrade to Pro - ${monthlyEquivalent}/mo
      </Button>
      {billingInterval === "annual" && annualSavings > 0 && (
        <Text size="xs" c="green">
          ${pricing.annualPrice}/yr — save ${annualSavings} vs monthly
        </Text>
      )}
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}
