import { redirect } from "next/navigation";
import { Container, Title } from "@mantine/core";

import { getServerAuthSession } from "~/server/auth";
import { api } from "~/trpc/server";
import { SubscriptionCard } from "./_components/SubscriptionCard";

export default async function SubscriptionPage() {
  const session = await getServerAuthSession();

  if (!session) {
    redirect("/login");
  }

  const caller = await api();
  const subscription = await caller.subscription.getCurrentSubscription();

  return (
    <Container size="md" py="xl">
      <Title order={1} mb="lg">
        Your Subscription
      </Title>
      <SubscriptionCard subscription={subscription} />
    </Container>
  );
}
