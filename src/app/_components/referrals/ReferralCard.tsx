"use client";

import { Avatar, Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { IconUserPlus } from "@tabler/icons-react";

import type { RouterOutputs } from "~/trpc/react";

type Referral = RouterOutputs["referral"]["getMyReferrals"][number];

const statusColorMap: Record<string, string> = {
  pending: "blue",
  signed_up: "teal",
  rewarded: "orange",
  expired: "gray",
};

const statusLabelMap: Record<string, string> = {
  pending: "Pending",
  signed_up: "Signed Up",
  rewarded: "Rewarded",
  expired: "Expired",
};

type ReferralCardProps = {
  referral: Referral;
};

export default function ReferralCard({ referral }: ReferralCardProps) {
  const statusColor = statusColorMap[referral.status] ?? "gray";
  const statusLabel = statusLabelMap[referral.status] ?? referral.status;
  const createdDate = new Date(referral.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" align="center">
        <Group gap="md">
          {referral.referred ? (
            <Avatar
              src={referral.referred.profilePic}
              radius="xl"
              size="md"
              color="orange"
            >
              {referral.referred.firstName?.[0]}
              {referral.referred.lastName?.[0]}
            </Avatar>
          ) : (
            <Avatar radius="xl" size="md" color="blue">
              <IconUserPlus size={18} />
            </Avatar>
          )}
          <Stack gap={2}>
            <Text fw={500} size="sm">
              {referral.referred
                ? `${referral.referred.firstName} ${referral.referred.lastName}`
                : "Waiting for sign-up"}
            </Text>
            <Text c="dimmed" size="xs">
              Code: {referral.code} -- Sent {createdDate}
            </Text>
          </Stack>
        </Group>
        <Badge color={statusColor} variant="light" size="sm">
          {statusLabel}
        </Badge>
      </Group>
    </Paper>
  );
}
