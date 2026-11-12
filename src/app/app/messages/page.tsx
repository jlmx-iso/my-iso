import { Center } from "@mantine/core";
import { IconMessageCircle } from "@tabler/icons-react";

import EmptyState from "~/app/_components/EmptyState";

/**
 * Thread pane of `/app/messages`. Phones show the conversation list here
 * instead; wide screens are sent on to the most recent thread by
 * MessagesShell, so this is only seen when there is nothing to open.
 */
export default function Page() {
  return (
    <Center h="100%" p="md">
      <EmptyState
        icon={IconMessageCircle}
        title="Your messages"
        description="Choose a conversation, or start one with New message."
      />
    </Center>
  );
}
