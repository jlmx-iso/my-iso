import { notFound } from "next/navigation";

import { api } from "~/trpc/server";

import MessageFeed from "../_components/MessageFeed";

export default async function Page({ params }: { params: Promise<{ id: string; }>; }) {
  const { id } = await params;
  // Null when the thread does not exist or the member is not part of it.
  const thread = await (await api()).message.getThreadById({ threadId: id });
  if (!thread) notFound();

  return <MessageFeed key={id} threadId={id} initialThread={thread} />;
}
