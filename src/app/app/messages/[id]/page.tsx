import PageHeading from "~/app/_components/PageHeading";
import { api } from "~/trpc/server";
import { getServerAuthSession } from "~/server/auth";
import ComposeMessage from "../_components/ComposeMessage";
import MessageListener from "../_components/MessageListener";
import MessageTile from "../_components/MessageTile";

export default async function Page({ params }: { params: { id: string; }; }) {
  const session = await getServerAuthSession();

  if(!session?.user) return null;

  const data = await api.message.getThreadById.query({ threadId: params.id });
  
  if(!data?.messages) return <div>No messages.</div>
  const { messages, participants } = data;
  // eslint-disable-next-line -- no unsafe any
  const title = participants.filter(p => p.id !== session.user.id).map(p => p.firstName + " " + p.lastName).join(", ");
  
  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <div className="flex flex-col items-center justify-center gap-4">
        <PageHeading>
          {title}
        </PageHeading>
        <div className="text-center text-2xl">
          {// eslint-disable-next-line 
            messages.map((message) => <MessageTile key={message.id} message={{ ...message, senderId: message.sender.id, isAuthor: session.user.id === message.sender.id }} />
          )}
        </div>
      </div>
      <MessageListener threadId={params.id} userId={session.user.id} />
      <ComposeMessage userId={session.user.id} threadId={params.id} />
    </div> 
  );

}