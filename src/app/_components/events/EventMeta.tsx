import { Group, Text } from "@mantine/core";
import { IconCalendar, IconCash, IconClock, IconHourglass, IconMapPin } from "@tabler/icons-react";

import { type EventTimeFormat } from "~/_lib/eventTime";
import { formatPay } from "~/_utils/eventPay";

import EventTime from "./EventTime";

function formatDuration(hours: number) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
}

type EventMetaProps = {
    date: Date | string;
    /** The event's IANA zone; the time is written in it, labelled. */
    timeZone?: string | null;
    duration: number;
    location: string | null;
    /** Listed pay in cents; nothing is shown when it is not listed. */
    payCents?: number | null;
    /**
     * How much of the start to write: the detail page gives weekday, day and
     * time; a feed card, whose date tile already shows the day, the time
     * (screen readers, which skip the tile, still hear the day).
     */
    timeFormat?: EventTimeFormat;
    /**
     * When to write the zone: always on the event page and in bookings;
     * on cards in a list only when it differs from the reader's.
     */
    zone?: "always" | "when-different";
};

function Item({ icon: Icon, label, children, strong = false }: {
    icon: typeof IconCalendar;
    label: string;
    children: React.ReactNode;
    strong?: boolean;
}) {
    return (
        <Group component="li" gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Icon size={16} aria-hidden style={{ flexShrink: 0, color: "var(--iso-info)" }} />
            <Text size="sm" fw={strong ? 600 : 400} style={{ overflowWrap: "anywhere" }}>
                <span className="sr-only">{label}: </span>
                {children}
            </Text>
        </Group>
    );
}

/**
 * When, where, what it pays and how long: plain text with an icon each
 * (and a text alternative for the icon), wrapping on a phone.
 */
export default function EventMeta({
    date,
    timeZone = null,
    duration,
    location,
    payCents = null,
    timeFormat = "dayTime",
    zone = "always",
}: EventMetaProps) {
    const pay = formatPay(payCents);
    const timeOnly = timeFormat === "time";
    return (
        <Group
            component="ul"
            wrap="wrap"
            m={0}
            p={0}
            style={{ columnGap: "var(--mantine-spacing-md)", listStyle: "none", rowGap: 4 }}
            data-testid="event-meta"
        >
            <Item icon={timeOnly ? IconClock : IconCalendar} label={timeOnly ? "Starts" : "Date"}>
                {timeOnly && (
                    <span className="sr-only">
                        <EventTime date={date} timeZone={timeZone} format="weekdayDate" />,{" "}
                    </span>
                )}
                <EventTime date={date} timeZone={timeZone} format={timeFormat} zone={zone} />
            </Item>
            {location && <Item icon={IconMapPin} label="Location">{location}</Item>}
            {pay && <Item icon={IconCash} label="Pay" strong>{pay} total</Item>}
            <Item icon={IconHourglass} label="Duration">{formatDuration(duration)}</Item>
        </Group>
    );
}
