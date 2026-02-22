"use client";

import { Container, Stack, Text, Title } from "@mantine/core";
import { IconUserPlus } from "@tabler/icons-react";

import EmptyState from "~/app/_components/EmptyState";
import PageHeader from "~/app/_components/PageHeader";
import { ReferralCard, ShareReferral } from "~/app/_components/referrals";
import { api } from "~/trpc/react";

export default function Page() {
  const { data: referrals, isLoading } =
    api.referral.getMyReferrals.useQuery();

  return (
    <Container size="md" py="lg">
      <Stack gap="lg">
        <PageHeader
          title="Referrals"
          description="Invite photographers and earn rewards when they join"
        />

        <ShareReferral />

        {/* Referral List */}
        <Stack gap="xs">
          <Title order={4}>Your Referrals</Title>
          {isLoading && (
            <Text c="dimmed" size="sm">
              Loading referrals...
            </Text>
          )}
          {!isLoading && (!referrals || referrals.length === 0) && (
            <EmptyState
              icon={IconUserPlus}
              title="No referrals yet"
              description="Share your referral link to start inviting photographers to ISO."
            />
          )}
          {referrals?.map((referral) => (
            <ReferralCard key={referral.id} referral={referral} />
          ))}
        </Stack>
      </Stack>
    </Container>
  );
}
