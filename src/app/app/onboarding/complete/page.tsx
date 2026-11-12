import { redirect } from "next/navigation";

import { auth } from "~/auth";

import { OnboardingComplete } from "../_components/OnboardingComplete";


type Props = {
  searchParams: Promise<{ plan?: string }>;
};

export default async function OnboardingCompletePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { plan } = await searchParams;

  return <OnboardingComplete plan={plan === "pro" ? "pro" : "free"} />;
}
