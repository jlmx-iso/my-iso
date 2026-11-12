import { Anchor, Button, type ButtonProps, Stack, Text } from "@mantine/core";
import { IconMessage, IconMessageOff } from "@tabler/icons-react";
import { TRPCError } from "@trpc/server";

import { NextLink } from "~/app/_components/NextLink";
import { api } from "~/trpc/server";

type MessageActionProps = {
  /** The profile's owner. */
  userId: string;
  /** Filled on a profile (its main action); "default" beside another action. */
  variant?: ButtonProps["variant"];
};

/** What the signed-in viewer can do about messaging this person. */
async function messagingOptions(userId: string): Promise<{ href: string } | { href: null }> {
  const caller = await api();
  // Someone the viewer already talks to: straight into that conversation.
  const thread = await caller.message.getThreadByParticipants({ participants: [userId] }).catch(() => null);
  if (thread) return { href: `/app/messages/${thread.id}` };

  try {
    await caller.message.getRecipientById({ userId });
  } catch (error) {
    // FORBIDDEN is the server's "you may not start a conversation with them".
    if (error instanceof TRPCError && error.code === "FORBIDDEN") return { href: null };
    // Anything else: offer the button; the composer reports what is wrong.
  }
  return { href: `/app/messages?new=${userId}` };
}

/**
 * "Message" button on a profile, for a signed-in viewer who is not the owner.
 * When the viewer may not start a conversation with this person (they are
 * not discoverable and the two have no match, booking or earlier message),
 * says so and how to connect, instead of a button that leads to an error.
 */
export async function MessageAction({ userId, variant = "filled" }: MessageActionProps) {
  const { href } = await messagingOptions(userId);

  if (href) {
    return (
      <Button component={NextLink} href={href} size="sm" variant={variant} leftSection={<IconMessage size={16} />}>
        Message
      </Button>
    );
  }

  return (
    <Stack gap={4} align="flex-start" maw={280} data-testid="message-unavailable">
      <Button
        size="sm"
        variant="default"
        disabled
        leftSection={<IconMessageOff size={16} />}
        aria-describedby="message-unavailable-hint"
      >
        Can&apos;t message yet
      </Button>
      <Text size="xs" c="dimmed" id="message-unavailable-hint">
        To connect, match with them on{" "}
        <Anchor component={NextLink} href="/app/discover" inherit underline="always">
          Discover
        </Anchor>{" "}
        or apply to one of their{" "}
        <Anchor component={NextLink} href="/app/events" inherit underline="always">
          events
        </Anchor>
        .
      </Text>
    </Stack>
  );
}
