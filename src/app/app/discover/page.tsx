import { Stack } from "@mantine/core";

import { CardStack } from "~/app/_components/discover";
import { DiscoverPreferences } from "~/app/_components/discover";
import PageHeader from "~/app/_components/PageHeader";

export default function DiscoverPage() {
  return (
    <Stack gap="lg">
      <PageHeader
        title="Discover"
        description="Find your perfect photographer match"
      />
      <DiscoverPreferences />
      <CardStack />
    </Stack>
  );
}
