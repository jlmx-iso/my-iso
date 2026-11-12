import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/auth";
import { getPricingForRole } from "~/server/_utils/pricing";
import { api } from "~/trpc/server";

import { OnboardingForm } from "./_components/OnboardingForm";

export const metadata: Metadata = { title: "Welcome" };

type PageProps = {
  searchParams: Promise<{ step?: string | string[] }>;
};

export default async function OnboardingPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/app/onboarding");
  }

  const { step } = await searchParams;
  const caller = await api();
  const photographer = await caller.photographer.getByUserId({ userId: session.user.id });

  // The profile already exists: only the plan step (reached by a reload or
  // the back button right after creating the profile) is still relevant.
  let initialStage: "welcome" | "plan" = "welcome";
  if (photographer) {
    if (step !== "plan") redirect("/app/events");
    const subscription = await caller.subscription.getStatus();
    if (subscription?.isActive) redirect("/app/onboarding/complete?plan=pro");
    initialStage = "plan";
  }

  const [user, photographerCount] = await Promise.all([
    caller.user.getMe(),
    caller.photographer.count(),
  ]);

  return (
    <OnboardingForm
      initialStage={initialStage}
      photographerCount={photographerCount}
      pricing={getPricingForRole(user.role)}
      user={user}
    />
  );
}
