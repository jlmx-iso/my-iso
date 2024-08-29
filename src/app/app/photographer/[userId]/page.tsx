import { api } from "~/trpc/server";
import { ProfilePage } from "~/app/_server_components";

export default async function Page({ params }: { params: { userId: string; }; }) {
  const { userId } = params;
  const photographer = await api.photographer.getByUserId.query({ userId });

  if (!photographer) {
    return (
      <div>
        <h1>Photographer not found</h1>
      </div>
    );
  };

  return <ProfilePage userId={photographer.userId} photographer={photographer} />;
}