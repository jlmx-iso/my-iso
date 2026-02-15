"use client";

import { Button, Stack, Text } from "@mantine/core";
import { IconCreditCard, IconExternalLink } from "@tabler/icons-react";
import { useState } from "react";

import { api } from "~/trpc/react";

type BillingActionsProps = {
  isProUser: boolean;
};

export default function BillingActions({ isProUser }: BillingActionsProps) {
  const [error, setError] = useState<string | null>(null);

  const createCheckout = api.subscription.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err) => {
      setError(err.message ?? "Failed to create checkout session");
    },
  });

  const createPortal = api.subscription.createPortalSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err) => {
      setError(err.message ?? "Failed to create portal session");
    },
  });

  if (isProUser) {
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
    <Stack gap="xs">
      <Button
        onClick={() => createCheckout.mutate()}
        loading={createCheckout.isPending}
        leftSection={<IconCreditCard size={18} />}
        color="orange"
        size="md"
      >
        Upgrade to Pro - $10/mo
      </Button>
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}
