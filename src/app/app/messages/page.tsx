import { Center, Text } from "@mantine/core";
import Link from "next/link";

import MessageFeed from "./_components/MessageFeed";

import { getServerAuthSession } from "~/server/auth";
import { api } from "~/trpc/server";

const MessageNotFound = () => (
  <Center display="block">
    <Text>Message not found</Text><br />
    <Link href="/app/messages">Back to messages</Link>
  </Center>
);

export default async function Page({ params }: { params: Promise<{ threadId?: string }> }) {
  const { threadId: initialThreadId } = await params;
  const session = await getServerAuthSession();
  if (!session?.user) return null;

  let threadId = initialThreadId;
  if (!threadId) {
    const latestThreadData = await (await api()).message.getLatestThreadByUserId();
    threadId = latestThreadData?.id;
    if (!threadId) return <MessageNotFound />;
  }

  return (
    <MessageFeed threadId={threadId} />
  );
};