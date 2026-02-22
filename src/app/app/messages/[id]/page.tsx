import MessageFeed from "../_components/MessageFeed";

import { auth } from "~/auth";
import { api } from "~/trpc/server";


export default async function Page({ params }: { params: Promise<{ id: string; }>; }) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user) return null;

  const data = await (await api()).message.getThreadById({ threadId: id });
  const recipient = data?.participants.find(p => p.id !== session.user.id);

  if (!recipient || !data?.messages) {
    return null;
  }

  return (
    <MessageFeed threadId={id} />
  );
}