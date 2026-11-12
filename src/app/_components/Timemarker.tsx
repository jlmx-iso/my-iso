"use client";

import { Text, Tooltip } from "@mantine/core";

import dayjs, { formatDate, formatRelative } from "~/_lib/dayjs";

/** Relative time ("2 hours ago") with the exact local time on hover/focus. */
export default function Timemarker({ date }: { date: Date; }) {
    return (
        <Tooltip label={formatDate(date, "dateTime")} position="bottom">
            <Text
                component="time"
                dateTime={dayjs(date).toISOString()}
                size="xs"
                c="dimmed"
                ta="right"
                style={{ cursor: "default", flexShrink: 0, whiteSpace: "nowrap" }}
                suppressHydrationWarning
            >
                {formatRelative(date)}
            </Text>
        </Tooltip>
    )
}
