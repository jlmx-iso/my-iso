import { Card, Flex, Stack, Text } from "@mantine/core";
import { type Message } from "@prisma/client";
import dayjs from "dayjs";

import Timemarker from "~/app/_components/Timemarker";

type TrimmedMessage = Pick<Message, "id" | "content" | "senderId" | "createdAt"> & {
  isAuthor: boolean;
};

const MessageTile = ({ message }: { message: TrimmedMessage; }) => {
  dayjs.locale("us");
  return (
    <Flex w="100%" direction={message.isAuthor ? "row-reverse" : "row"} p="xs" m={0}>
      <Flex align={message.isAuthor ? "end" : "start"} justify="center" direction="column">
        <Card shadow="sm" padding="xs" radius="sm" mb={2} bg={message.isAuthor ? "#FA8072" : "#D2B48C"} w="auto" maw="16rem">
          <Stack m={4}>
            <Text>{message.content}</Text>
          </Stack>
        </Card>
        <Timemarker date={message.createdAt} />
      </Flex>
    </Flex>
  );
};

export default MessageTile;