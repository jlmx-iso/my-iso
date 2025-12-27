import { redirect } from "next/navigation";
import { Container, Title, Text, Button, Stack } from "@mantine/core";
import Link from "next/link";

import { getServerAuthSession } from "~/server/auth";

export default async function SubscriptionSuccessPage() {
  const session = await getServerAuthSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg" align="center">
        <Title order={1}>Welcome to Pro!</Title>
        <Text size="lg" ta="center">
          Thank you for subscribing! Your account has been upgraded to Pro.
        </Text>
        <Text size="md" c="dimmed" ta="center">
          You now have access to all Pro features. Start exploring!
        </Text>
        <Link href="/app/subscription">
          <Button size="lg">View Subscription</Button>
        </Link>
        <Link href="/app/events">
          <Button variant="subtle">Go to Events</Button>
        </Link>
      </Stack>
    </Container>
  );
}
