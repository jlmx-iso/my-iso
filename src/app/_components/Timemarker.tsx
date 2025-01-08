import { Text, Tooltip } from "@mantine/core";

import dayjs from "~/_lib/dayjs";

export default function Timemarker({ date }: { date: Date; }) {
    return (
        <Tooltip label={dayjs(date).utc().local().format("MM/DD/YYYY h:mm A")} position="bottom">
            <Text size="xs" c="dimmed" fs="italic" ta="right" style={{ cursor: "default" }}>{dayjs(date).fromNow()}</Text>
        </Tooltip>
    )
}