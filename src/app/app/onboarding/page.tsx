import { redirect } from "next/navigation";

import { OnboardingForm } from "./_components/OnboardingForm";

import { auth } from "~/auth";
import { getPricingForRole } from "~/server/_utils/pricing";
import { api } from "~/trpc/server";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const caller = await api();
  const photographer = await caller.photographer.getByUserId({ userId: session.user.id });
  if (photographer) {
    redirect("/app/events");
  }

  const user = await caller.user.getMe();
  const pricing = getPricingForRole(user.role);
  const photographerCount = await caller.photographer.count();

  return <OnboardingForm photographerCount={photographerCount} pricing={pricing} user={user} />;
}
