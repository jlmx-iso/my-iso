import { ProfilePage } from "~/app/_components/profiles/ProfilePage";
import { api } from "~/trpc/server";

export default async function Page({ params }: { params: Promise<{ userId: string; }>; }) {
  const { userId } = await params;
  const photographer = await (await api()).photographer.getByUserId({ userId });

  if (!photographer) {
    return (
      <div>
        <h1>Photographer not found</h1>
      </div>
    );
  };

  return <ProfilePage userId={photographer.userId} photographer={photographer} />;
}