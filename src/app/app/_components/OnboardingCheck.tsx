"use client";

import { usePathname } from "next/navigation";
import { redirect } from "next/navigation";

export function OnboardingCheck({
  needsOnboarding,
  children,
}: {
  needsOnboarding: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (needsOnboarding && !pathname.startsWith("/app/onboarding")) {
    redirect("/app/onboarding");
  }

  return <>{children}</>;
}
