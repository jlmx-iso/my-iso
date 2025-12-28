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
      } else {
        notifications.show({
          color: 'red',
          message: 'Failed to get portal URL. Please try again.',
          title: 'Error',
        });
        setLoading(false);
      }
    },
  });

  const handleManage = () => {
    setLoading(true);
    // Strip query parameters from return URL to avoid exposing sensitive data to Stripe
    const returnUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
    createPortal.mutate({
      returnUrl,
    });
  };

  // Show pending subscription with special handling
  if (subscription?.isPending && !subscription.isActive) {
    return (
      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Text size="lg" fw={700}>
              {subscription.planName || 'Pro'} Subscription
            </Text>
            <Badge color="orange">Payment Processing</Badge>
          </Group>
          <Text size="sm" c="orange">
            Your payment is being processed. This usually takes a few minutes.
            Once complete, your subscription will be activated automatically.
          </Text>
          <Text size="sm" c="dimmed">
            If you're experiencing issues, please check your email for payment instructions
            or contact support.
          </Text>
          <Button
            onClick={handleManage}
            loading={loading}
            variant="light"
          >
            Update Payment Method
          </Button>
        </Stack>
      </Card>
    );
  }

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

  /**
   * Badge priority logic (checked in order):
   * 1. Expired - highest priority (subscription completely ended)
   * 2. Canceled - subscription is ending but still has access
   * 3. Paused - subscription is paused
   * 4. Pending - payment incomplete
   * 5. Trial - in trial period
   * 6. Active - normal active state
   */
  const getStatusBadge = () => {
    if (subscription.isExpired) {
      return <Badge color="red">Expired</Badge>;
    }
    if (subscription.isCanceled) {
      return <Badge color="yellow">Canceled</Badge>;
    }
    if (subscription.isPaused) {
      return <Badge color="gray">Paused</Badge>;
    }
    if (subscription.isPending) {
      return <Badge color="orange">Pending Payment</Badge>;
    }
    if (subscription.isTrial) {
      return <Badge color="blue">Trial</Badge>;
    }
    if (subscription.isActive) {
      return <Badge color="green">Active</Badge>;
    }
    return <Badge>Unknown</Badge>;
  };

  // Disable manage button for expired subscriptions
  const isManageable = !subscription.isExpired;

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="lg" fw={700}>
            {subscription.planName || 'Pro'} Subscription
          </Text>
          {getStatusBadge()}
        </Group>

        {subscription.isTrial && !subscription.isCanceled && (
          <Text size="sm" c="blue">
            You are currently in your trial period. Enjoy full access!
          </Text>
        )}

        {subscription.isCanceled && !subscription.isExpired && (
          <Text size="sm" c="yellow">
            Your subscription is canceled and will expire on{' '}
            {subscription.expiresAt
              ? new Date(subscription.expiresAt).toLocaleDateString()
              : 'N/A'}
            . You still have access until then.
          </Text>
        )}

        {subscription.isExpired && (
          <Text size="sm" c="red">
            Your subscription has expired. Please subscribe again to regain access.
          </Text>
        )}

        {subscription.expiresAt && subscription.isActive && !subscription.isCanceled && (
          <Text size="sm" c="dimmed">
            {subscription.isTrial ? 'Trial ends' : 'Next billing date'}:{' '}
            {new Date(subscription.expiresAt).toLocaleDateString()}
          </Text>
        )}

        {subscription.isPaused && (
          <Text size="sm" c="gray">
            Your subscription is currently paused. Billing will resume when you unpause.
          </Text>
        )}

        {subscription.isExpired ? (
          <Link href="/pricing">
            <Button fullWidth>Subscribe Again</Button>
          </Link>
        ) : (
          <Button
            onClick={handleManage}
            loading={loading}
            disabled={!isManageable}
          >
            Manage Subscription
          </Button>
        )}

        {isManageable && (
          <Text size="xs" c="dimmed">
            Clicking "Manage Subscription" will take you to Stripe's secure portal
            where you can update your payment method, cancel, or resume your
            subscription.
          </Text>
        )}
      </Stack>
    </Card>
  );
}
