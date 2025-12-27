'use client';

import { useState } from "react";
import { Button, Card, Stack, Text, Badge, Group } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import Link from "next/link";

import { api } from "~/trpc/react";
import type { Subscription } from "@prisma/client";

type SubscriptionCardProps = {
  subscription: Subscription | null;
};

export function SubscriptionCard({ subscription }: SubscriptionCardProps) {
  const [loading, setLoading] = useState(false);

  const createPortal = api.subscription.createPortalSession.useMutation({
    onError: (error) => {
      notifications.show({
        color: 'red',
        message: error.message || 'Failed to open portal. Please try again.',
        title: 'Error',
      });
      setLoading(false);
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
  });

  const handleManage = () => {
    setLoading(true);
    createPortal.mutate({
      returnUrl: window.location.href,
    });
  };

  if (!subscription || (!subscription.isActive && !subscription.isTrial)) {
    return (
      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Stack gap="md">
          <Text size="lg" fw={700}>
            No Active Subscription
          </Text>
          <Text size="sm" c="dimmed">
            You are currently on the free Basic plan. Upgrade to Pro for more features!
          </Text>
          <Link href="/pricing">
            <Button>View Plans</Button>
          </Link>
        </Stack>
      </Card>
    );
  }

  const getStatusBadge = () => {
    if (subscription.isTrial) {
      return <Badge color="blue">Trial</Badge>;
    }
    if (subscription.isActive && !subscription.isCanceled) {
      return <Badge color="green">Active</Badge>;
    }
    if (subscription.isCanceled) {
      return <Badge color="yellow">Canceled</Badge>;
    }
    if (subscription.isPaused) {
      return <Badge color="gray">Paused</Badge>;
    }
    if (subscription.isExpired) {
      return <Badge color="red">Expired</Badge>;
    }
    return <Badge>Unknown</Badge>;
  };

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="lg" fw={700}>
            Pro Subscription
          </Text>
          {getStatusBadge()}
        </Group>

        {subscription.isTrial && (
          <Text size="sm" c="blue">
            You are currently in your trial period.
          </Text>
        )}

        {subscription.isCanceled && !subscription.isExpired && (
          <Text size="sm" c="yellow">
            Your subscription is canceled and will expire on{' '}
            {subscription.expiresAt
              ? new Date(subscription.expiresAt).toLocaleDateString()
              : 'N/A'}
            .
          </Text>
        )}

        {subscription.expiresAt && subscription.isActive && !subscription.isCanceled && (
          <Text size="sm" c="dimmed">
            Next billing date:{' '}
            {new Date(subscription.expiresAt).toLocaleDateString()}
          </Text>
        )}

        {subscription.isPaused && (
          <Text size="sm" c="gray">
            Your subscription is currently paused.
          </Text>
        )}

        <Button onClick={handleManage} loading={loading}>
          Manage Subscription
        </Button>

        <Text size="xs" c="dimmed">
          Clicking "Manage Subscription" will take you to Stripe's secure portal
          where you can update your payment method, cancel, or resume your
          subscription.
        </Text>
      </Stack>
    </Card>
  );
}
