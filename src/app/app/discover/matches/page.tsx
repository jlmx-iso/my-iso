import { Anchor, Group, Stack } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import type { Metadata } from "next";

import MatchesList from "~/app/_components/discover/MatchesList";
import { NextLink } from "~/app/_components/NextLink";
import PageHeader from "~/app/_components/PageHeader";

export const metadata: Metadata = { title: "Matches" };

export default function MatchesPage() {
  return (
    <Stack gap="lg" maw={720} mx="auto">
      <Anchor component={NextLink} href="/app/discover" c="dimmed" size="sm" w="fit-content" className="tap-link">
        <Group gap={4} wrap="nowrap"><IconArrowLeft size={14} aria-hidden /> Back to Discover</Group>
      </Anchor>
      <PageHeader
        title="Matches"
        description="Photographers who liked you back. Open one to start talking."
      />
      <MatchesList />
    </Stack>
  );
}
