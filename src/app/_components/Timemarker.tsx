"use client";

import { Text, Tooltip } from "@mantine/core";

import dayjs from "~/_lib/dayjs";

/** Relative time ("2 hours ago") with the exact local time on hover/focus. */
export default function Timemarker({ date }: { date: Date; }) {
    const exact = dayjs(date).utc().local();
    return (
        <Tooltip label={exact.format("MMM D, YYYY h:mm A")} position="bottom">
            <Text
                component="time"
                dateTime={exact.toISOString()}
                size="xs"
                c="dimmed"
                ta="right"
                style={{ cursor: "default", flexShrink: 0, whiteSpace: "nowrap" }}
                suppressHydrationWarning
            >
                {dayjs(date).fromNow()}
            </Text>
        </Tooltip>
    )
}
