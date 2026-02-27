import { Button, Container, Stack, Text, Title } from "@mantine/core";
import { IconUserOff } from "@tabler/icons-react";

import { ProfilePage } from "~/app/_components/profiles/ProfilePage";
import { api } from "~/trpc/server";

export default async function Page({ params }: { params: Promise<{ userId: string; }>; }) {
  const { userId } = await params;
  const photographer = await (await api()).photographer.getByUserId({ userId });

  if (!photographer) {
    return (
      <Container size="sm" py="xl">
        <Stack align="center" gap="md">
          <IconUserOff size={64} color="var(--mantine-color-gray-4)" />
          <Title order={2}>Photographer not found</Title>
          <Text c="dimmed">This profile doesn&apos;t exist or may have been removed.</Text>
          <Button component="a" href="/app/discover" variant="light">
            Browse Photographers
          </Button>
        </Stack>
      </Container>
    );
  };

  return <ProfilePage userId={photographer.userId} photographer={photographer} />;
}