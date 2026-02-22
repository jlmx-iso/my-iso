import { ProfilePage } from "../../_components/profiles/ProfilePage";

import { auth } from "~/auth";



export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const resolvedSearchParams = await searchParams;
  const session = await auth()

  if (!session || !session.user) {
    return null;
  };

  const isEditing = resolvedSearchParams.edit === "true";
  const isSuccess = resolvedSearchParams.success === "true";
  const userId = session.user.id;

  return <ProfilePage userId={userId} isEditing={isEditing} isSuccess={isSuccess} />;
};