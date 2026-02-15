import { redirect } from "next/navigation";

import { OnboardingForm } from "./_components/OnboardingForm";

import { auth } from "~/auth";
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

  return <OnboardingForm user={user} />;
}
