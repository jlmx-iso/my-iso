import { getServerSession } from "next-auth";
import { ProfilePage } from "../../_server_components";
import { authOptions } from "~/server/auth";

export default async function Page() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return null;
  };
  const userId = session.user.id;
  return <ProfilePage userId={userId} />;
};