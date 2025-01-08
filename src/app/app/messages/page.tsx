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

export default async function Page({ params: { threadId } }: { params: { threadId?: string } }) {
  const session = await getServerAuthSession();
  if (!session?.user) return null;

  if (!threadId) {
    const latestThreadData = await api.message.getLatestThreadByUserId.query();
    threadId = latestThreadData?.id;
    if (!threadId) return <MessageNotFound />;
  }

  return (
    <MessageFeed threadId={threadId} />
  );
};