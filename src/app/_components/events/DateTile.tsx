"use client";

import { Paper, Text } from "@mantine/core";
import { useSyncExternalStore } from "react";

import { eventDay } from "~/_lib/eventTime";

function subscribeToNothing() {
    return () => undefined;
}

type DateTileProps = {
    date: Date | string;
    timeZone: string | null | undefined;
    /** Greyed out: the event has already started. */
    isPast?: boolean;
};

/**
 * The event's day as a small calendar leaf (NOV / 22 / Sun), in the
 * event's own zone, so a feed can be scanned by date. Decorative for
 * screen readers: the card's details say the date in words.
 */
export default function DateTile({ date, timeZone, isPast = false }: DateTileProps) {
    const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);
    const day = isClient ? eventDay(date, timeZone) : null;
    return (
        <Paper
            withBorder
            radius="md"
            w={56}
            py={6}
            ta="center"
            aria-hidden
            // Upcoming: the date-tile tokens (globals.css), the coral tint on
            // white and a raised navy panel with a salmon month in dark mode.
            style={{ flexShrink: 0, borderColor: isPast ? undefined : "var(--iso-tile-border)" }}
            bg={isPast ? "var(--mantine-color-default)" : "var(--iso-tile-bg)"}
            data-testid="date-tile"
        >
            <Text size="xs" fw={700} tt="uppercase" lh={1.2} c={isPast ? "dimmed" : "var(--iso-tile-month)"}>
                {day?.month ?? " "}
            </Text>
            <Text fz={22} fw={700} lh={1.1} c={isPast ? undefined : "var(--iso-tile-day)"}>
                {day?.day ?? " "}
            </Text>
            <Text size="xs" c="dimmed" lh={1.2}>
                {day?.weekday ?? " "}
            </Text>
        </Paper>
    );
}
