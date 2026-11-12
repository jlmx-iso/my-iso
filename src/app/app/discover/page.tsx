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
        description="Like the photographers you'd work with. When it's mutual, you match."
        action={
          <Button
            component={NextLink}
            href="/app/discover/matches"
            variant="light"
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
