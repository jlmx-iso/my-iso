import MessageFeed from "../_components/MessageFeed";

import { logger } from "~/_utils";
import { getServerAuthSession } from "~/server/auth";
import { api } from "~/trpc/server";


export default async function Page({ params }: { params: { id: string; }; }) {
  const session = await getServerAuthSession();

  if (!session?.user) return null;

  const data = await api.message.getThreadById.query({ threadId: params.id });
  logger.info("retrieved messages", { data });
  const recipient = data?.participants.find(p => p.id !== session.user.id);

  if (!recipient) {
    return null;
  }

  if (!data?.messages) return <div>No messages.</div>

  return (
    <MessageFeed threadId={params.id} />
  );

}