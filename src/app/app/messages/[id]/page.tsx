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
    // eslint-disable-next-line
    console.log("No recipient found", { participants: data?.participants });
    return null;
  }

  if (!data?.messages) return <div>No messages.</div>
  const { messages, participants } = data;
  // eslint-disable-next-line -- no unsafe any
  const title = participants.filter(p => p.id !== session.user.id).map(p => p.firstName + " " + p.lastName).join(", ");
  // eslint-disable-next-line
  console.log("messages", messages);

  return (
    <MessageFeed threadId={params.id} />
  );

}