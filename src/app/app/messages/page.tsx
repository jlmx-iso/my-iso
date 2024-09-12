import Link from "next/link";

import PageHeading from "~/app/_components/PageHeading";
import { getServerAuthSession } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function Page() {
  const session = await getServerAuthSession();
  if (!session?.user) return null;
  const messageThreads = await api.message.getByUserId.query({ userId: session.user.id });

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <PageHeading>Messages</PageHeading>
      <div className="flex flex-col items-center gap-2">
        <div className="flex flex-col items-center justify-center gap-4">
          <p className="text-center text-2xl">
            {messageThreads.map((messageThread) => {
              // remove current user from list of participants
              const participants = messageThread.participants.filter((participant) => participant.id !== session.user.id);
              return (<Link key={messageThread.id} href={`/app/messages/${messageThread.id}`}>{participants.map(p => p.firstName)}</Link>);
            })}
          </p>
        </div>
      </div>
    </div> 
  );
};