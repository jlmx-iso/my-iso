import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/auth";
import { api } from "~/trpc/server";

import { OnboardingComplete } from "../_components/OnboardingComplete";

export const metadata: Metadata = { title: "You're in" };

type Props = {
  searchParams: Promise<{ plan?: string | string[] }>;
};

export default async function OnboardingCompletePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/app/onboarding/complete");
  }

  const { plan } = await searchParams;
  // `?plan=pro` only says the member was sent back from checkout; whether
  // they are on Pro is the server's subscription record.
  const subscription = await (await api()).subscription.getStatus();

  return (
    <OnboardingComplete
      cameFromCheckout={plan === "pro"}
      isSubscriptionActive={subscription?.isActive === true}
    />
  );
}
