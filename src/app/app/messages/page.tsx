import { Center } from "@mantine/core";
import { IconMessageCircle } from "@tabler/icons-react";

import MessageFeed from "./_components/MessageFeed";

import EmptyState from "~/app/_components/EmptyState";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

export default async function Page({ params }: { params: Promise<{ threadId?: string }> }) {
  const { threadId: initialThreadId } = await params;
  const session = await auth();
  if (!session?.user) return null;

  let threadId = initialThreadId;
  if (!threadId) {
    const latestThreadData = await (await api()).message.getLatestThreadByUserId();
    threadId = latestThreadData?.id;
    if (!threadId) {
      return (
        <Center h="100%">
          <EmptyState
            icon={IconMessageCircle}
            title="No messages yet"
            description="Start a conversation using the New Message button."
          />
        </Center>
      );
    }
  }

  return (
    <MessageFeed threadId={threadId} />
  );
}
