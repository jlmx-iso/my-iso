import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProfilePage } from "~/app/_components/profiles/ProfilePage";
import { api } from "~/trpc/server";

type PageProps = { params: Promise<{ userId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { userId } = await params;
  const photographer = await (await api()).photographer.getByUserId({ userId });
  return { title: photographer?.name ?? "Photographer not found" };
}

export default async function Page({ params }: PageProps) {
  const { userId } = await params;
  const photographer = await (await api()).photographer.getByUserId({ userId });
  if (!photographer) notFound();

  return <ProfilePage photographer={photographer} />;
}
