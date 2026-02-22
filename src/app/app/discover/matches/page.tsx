import { Stack } from "@mantine/core";

import PageHeader from "~/app/_components/PageHeader";
import { MatchesList } from "~/app/_components/discover";

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
