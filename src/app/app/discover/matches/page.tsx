import { Stack } from "@mantine/core";

import { MatchesList } from "~/app/_components/discover";
import PageHeader from "~/app/_components/PageHeader";

export default function MatchesPage() {
  return (
    <Stack gap="lg">
      <PageHeader
        title="Matches"
        description="Your connections"
      />
      <MatchesList />
    </Stack>
  );
}
