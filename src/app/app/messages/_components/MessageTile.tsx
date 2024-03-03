import { Card, Stack, Text } from "@mantine/core";
import { type Message } from "@prisma/client";
import dayjs from "dayjs";

type TrimmedMessage = Pick<Message, "id" | "content" | "senderId" | "createdAt"> & {
  isAuthor: boolean;
};

const MessageTile = ({ message }: { message: TrimmedMessage; }) => {
  dayjs.locale("us");
  return (
      <Stack m={8}>
        <Card shadow="sm" padding="sm" radius="sm" bg={message.isAuthor ? "#FA8072" : "#D2B48C"} right={message.isAuthor ? "-100%" : "100%"}>
          <Text>{message.content}</Text>
        </Card>
        {/* <Text size="xs">{dayjs(new Date(message.createdAt.toString() + "Z")).format("MM/DD/YYYY h:mm A")}</Text> */}
      </Stack>
    );
};

export default MessageTile;