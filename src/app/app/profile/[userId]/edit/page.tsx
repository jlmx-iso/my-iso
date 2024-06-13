import { getServerSession } from "next-auth";
import { ProfilePage } from "../../../../_server_components";
import { authOptions } from "~/server/auth";

export default async function Page({ params }: { params: { userId: string } }) {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || session.user.id !== params.userId) {
        return null;
    };

    return (
        <ProfilePage userId={params.userId} isEditing={true} />
    )
}