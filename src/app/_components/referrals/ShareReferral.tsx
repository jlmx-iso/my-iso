"use client";

import {
  Button,
  CopyButton,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconCheck,
  IconCopy,
  IconGift,
  IconUserCheck,
  IconUsers,
} from "@tabler/icons-react";

import { api } from "~/trpc/react";

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size: number; stroke?: number }>;
  color: string;
}) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group gap="sm">
        <Icon size={24} stroke={1.5} />
        <Stack gap={2}>
          <Text size="xl" fw={700} c={color}>
            {value}
          </Text>
          <Text size="xs" c="dimmed">
            {label}
          </Text>
        </Stack>
      </Group>
    </Paper>
  );
}

export default function ShareReferral() {
  const { data: code, isLoading: codeLoading } =
    api.referral.getMyCode.useQuery();
  const { data: stats, isLoading: statsLoading } =
    api.referral.getStats.useQuery();

  const referralUrl = code
    ? `${window.location.origin}/register?ref=${code}`
    : "";

  if (codeLoading || statsLoading) {
    return (
      <Paper withBorder p="xl" radius="md">
        <Text c="dimmed">Loading your referral info...</Text>
      </Paper>
    );
  }

  return (
    <Stack gap="lg">
      {/* Share Section */}
      <Paper withBorder p="xl" radius="md">
        <Stack gap="md">
          <Title order={4}>Your Referral Link</Title>
          <Text size="sm" c="dimmed">
            Share this link with fellow photographers. When they sign up, you
            both benefit!
          </Text>
          <Group gap="sm" align="flex-end">
            <TextInput
              value={referralUrl}
              readOnly
              label="Referral URL"
              style={{ flex: 1 }}
              styles={{
                input: { fontFamily: "monospace", fontSize: 13 },
              }}
            />
            <CopyButton value={referralUrl}>
              {({ copied, copy }) => (
                <Button
                  color={copied ? "teal" : "orange"}
                  onClick={copy}
                  leftSection={
                    copied ? <IconCheck size={16} /> : <IconCopy size={16} />
                  }
                >
                  {copied ? "Copied" : "Copy Link"}
                </Button>
              )}
            </CopyButton>
          </Group>
        </Stack>
      </Paper>

      {/* Stats Section */}
      {stats && (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <StatCard
            label="Referrals Sent"
            value={stats.totalSent}
            icon={IconUsers}
            color="blue"
          />
          <StatCard
            label="Signed Up"
            value={stats.totalSignedUp}
            icon={IconUserCheck}
            color="teal"
          />
          <StatCard
            label="Rewards Earned"
            value={stats.totalRewarded}
            icon={IconGift}
            color="orange"
          />
        </SimpleGrid>
      )}
    </Stack>
  );
}
