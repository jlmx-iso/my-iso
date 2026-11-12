"use client";

import { Text, Tooltip } from "@mantine/core";

import dayjs, { formatDate, formatRelative } from "~/_lib/dayjs";

type TimemarkerProps = {
    date: Date;
    /** A word before the time: "Posted" reads "Posted 2 hours ago". */
    prefix?: string;
};

/** Relative time ("2 hours ago") with the exact local time on hover/focus. */
export default function Timemarker({ date, prefix }: TimemarkerProps) {
    return (
        <Tooltip label={formatDate(date, "dateTime")} position="bottom">
            <Text
                size="xs"
                c="dimmed"
                ta="right"
                style={{ cursor: "default", flexShrink: 0, whiteSpace: "nowrap" }}
            >
                {prefix && `${prefix} `}
                <time dateTime={dayjs(date).toISOString()} suppressHydrationWarning>
                    {formatRelative(date)}
                </time>
            </Text>
        </Tooltip>
    )
}
