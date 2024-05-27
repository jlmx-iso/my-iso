import { api } from "~/trpc/server";
import { ProfilePage } from "~/app/_server_components";

export default async function Page({ params }: { params: { username: string; }; }) {
  const { username } = params;
  const photographer = await api.photographer.getByUsername.query({ username });

  if (!photographer) {
    return (
      <div>
        <h1>Photographer not found</h1>
      </div>
    );
  };

  return <ProfilePage userId={photographer.userId} photographer={photographer} />;
}