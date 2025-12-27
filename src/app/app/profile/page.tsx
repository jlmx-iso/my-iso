import { getServerSession } from "next-auth";

import { ProfilePage } from "../../_components/profiles/ProfilePage";

import { authOptions } from "~/server/auth";



export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const resolvedSearchParams = await searchParams;
  const session = await getServerSession(authOptions)

  if (!session || !session.user) {
    return null;
  };

  const isEditing = resolvedSearchParams.edit === "true";
  const isSuccess = resolvedSearchParams.success === "true";
  const userId = session.user.id;

  return <ProfilePage userId={userId} isEditing={isEditing} isSuccess={isSuccess} />;
};