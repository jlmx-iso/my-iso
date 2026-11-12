import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/auth";
import { api } from "~/trpc/server";

import { ProfilePage } from "../../_components/profiles/ProfilePage";

export const metadata: Metadata = { title: "Your profile" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const [{ edit }, session] = await Promise.all([searchParams, auth()]);
  if (!session?.user) redirect("/login?callbackUrl=/app/profile");

  const photographer = await (await api()).photographer.getByUserId({ userId: session.user.id });
  // The app layout sends members without a profile to onboarding first.
  if (!photographer) redirect("/app/onboarding");

  return <ProfilePage photographer={photographer} isEditing={edit === "true"} />;
}
