import { Button, Stack } from "@mantine/core";
import { IconHeartHandshake } from "@tabler/icons-react";
import type { Metadata } from "next";


import CardStack from "~/app/_components/discover/CardStack";
import DiscoverPreferences from "~/app/_components/discover/DiscoverPreferences";
import { NextLink } from "~/app/_components/NextLink";
import PageHeader from "~/app/_components/PageHeader";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage() {
  return (
    <Stack gap="lg">
      <PageHeader
        title="Discover"
        description="Like photographers you'd shoot with. If they like you back, you match and can message each other."
        action={
          <Button
            component={NextLink}
            href="/app/discover/matches"
            variant="light"
            // Lavender: Discover and people.
            color="purple"
            size="sm"
            leftSection={<IconHeartHandshake size={18} />}
          >
            Matches
          </Button>
        }
      />
      <DiscoverPreferences />
      <CardStack />
    </Stack>
  );
}
