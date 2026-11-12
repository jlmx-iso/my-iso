import { Container, Stack } from "@mantine/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { hasProAccess } from "~/_utils/subscriptionView";
import PageHeader from "~/app/_components/PageHeader";
import SupportCard from "~/app/_components/support/SupportCard";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

export const metadata: Metadata = { title: "Help & support" };

/** The account menu's "Help & support": priority support for Pro, the contact route for everyone else. */
export default async function SupportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/app/support");

  const subscription = await (await api()).subscription.getStatus();

  return (
    <Container size="sm" py="lg" px={0}>
      <Stack gap="xl">
        <PageHeader title="Help & support" description="Reach the team behind ISO" />
        <SupportCard isPro={hasProAccess(subscription)} />
      </Stack>
    </Container>
  );
}
