import { Box, Flex, Text } from "@mantine/core";
import { type Message } from "@prisma/client";

import Timemarker from "~/app/_components/Timemarker";

type TrimmedMessage = Pick<Message, "id" | "content" | "senderId" | "createdAt"> & {
  isAuthor: boolean;
};

const MessageTile = ({ message, showTimestamp = true, isLastInGroup = false }: { message: TrimmedMessage; showTimestamp?: boolean; isLastInGroup?: boolean }) => {
  const isAuthor = message.isAuthor;

  return (
    <Flex
      w="100%"
      direction={isAuthor ? "row-reverse" : "row"}
      py={1}
      px="xs"
      mb={isLastInGroup ? 8 : 0}
      style={{
        animation: "messageIn 1s cubic-bezier(0.16, 1, 0.3, 1) both",
      }}
    >
      <Flex
        align={isAuthor ? "end" : "start"}
        direction="column"
        maw="70%"
        gap={2}
      >
        <Box
          px="md"
          py="sm"
          style={{
            borderRadius: isAuthor
              ? "18px 18px 4px 18px"
              : "18px 18px 18px 4px",
            backgroundColor: isAuthor
              ? "var(--mantine-color-orange-1)"
              : "var(--mantine-color-gray-1)",
          }}
        >
          <Text size="sm" style={{ lineHeight: 1.5 }}>
            {message.content}
          </Text>
        </Box>
        {showTimestamp && (
          <Text size="xs" c="dimmed" px={4}>
            <Timemarker date={message.createdAt} />
          </Text>
        )}
      </Flex>
    </Flex>
  );
};

export default MessageTile;
