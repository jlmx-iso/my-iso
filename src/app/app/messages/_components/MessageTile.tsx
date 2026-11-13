import { Box, Flex, Text } from "@mantine/core";

import { type ThreadMessage } from "~/_utils/threadMessages";
import Timemarker from "~/app/_components/Timemarker";

type MessageTileProps = {
  isAuthor: boolean;
  /** Last of a run of messages from the same sender: shows the time. */
  isLastInGroup?: boolean;
  message: Pick<ThreadMessage, "content" | "createdAt" | "sender">;
};

const MessageTile = ({ isAuthor, isLastInGroup = false, message }: MessageTileProps) => {
  return (
    <Flex
      w="100%"
      direction={isAuthor ? "row-reverse" : "row"}
      py={1}
      px="xs"
      mb={isLastInGroup ? 8 : 0}
      style={{
        animation: "messageIn 300ms cubic-bezier(0.16, 1, 0.3, 1) both",
      }}
      data-testid="message-tile"
    >
      <Flex
        align={isAuthor ? "end" : "start"}
        direction="column"
        maw={{ base: "85%", sm: "70%" }}
        gap={2}
      >
        <Box
          px="md"
          py="xs"
          // Scheme-aware (globals.css): your own bubble is the coral (the
          // pastel with dark text in dark mode), theirs a neutral surface.
          bg={isAuthor ? "var(--iso-bubble-own)" : "var(--iso-surface-muted)"}
          style={{
            borderRadius: isAuthor
              ? "18px 18px 4px 18px"
              : "18px 18px 18px 4px",
          }}
        >
          <Text
            size="sm"
            c={isAuthor ? "var(--iso-bubble-own-text)" : undefined}
            style={{ lineHeight: 1.5, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
            data-replay-block
          >
            <span className="sr-only">{isAuthor ? "You: " : `${message.sender.firstName}: `}</span>
            {message.content}
          </Text>
        </Box>
        {isLastInGroup && (
          <Box px={4}>
            <Timemarker date={message.createdAt} />
          </Box>
        )}
      </Flex>
    </Flex>
  );
};

export default MessageTile;
