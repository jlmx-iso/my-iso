import { Group, Text } from "@mantine/core";
import { IconCalendar, IconCash, IconClock, IconMapPin } from "@tabler/icons-react";

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
     * time; a feed card, whose date tile already shows the day, the time.
     */
    timeFormat?: EventTimeFormat;
};

function Item({ icon: Icon, label, children, strong = false }: {
    icon: typeof IconCalendar;
    label: string;
    children: React.ReactNode;
    strong?: boolean;
}) {
    return (
        <Group component="li" gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Icon size={16} aria-hidden style={{ flexShrink: 0, color: "var(--mantine-color-dimmed)" }} />
            <Text size="sm" fw={strong ? 600 : 400} style={{ overflowWrap: "anywhere" }}>
                <span className="sr-only">{label}: </span>
                {children}
            </Text>
        </Group>
    );
}

/**
 * When, where, how long and what it pays: plain text with an icon each
 * (and a text alternative for the icon), in that order, wrapping on a phone.
 */
export default function EventMeta({ date, timeZone = null, duration, location, payCents = null, timeFormat = "dayTime" }: EventMetaProps) {
    const pay = formatPay(payCents);
    return (
        <Group
            component="ul"
            wrap="wrap"
            m={0}
            p={0}
            style={{ columnGap: "var(--mantine-spacing-md)", listStyle: "none", rowGap: 4 }}
            data-testid="event-meta"
        >
            <Item icon={IconCalendar} label={timeFormat === "time" ? "Starts" : "Date"}>
                <EventTime date={date} timeZone={timeZone} format={timeFormat} />
            </Item>
            {location && <Item icon={IconMapPin} label="Location">{location}</Item>}
            <Item icon={IconClock} label="Duration">{formatDuration(duration)}</Item>
            {pay && <Item icon={IconCash} label="Pay" strong>{pay}</Item>}
        </Group>
    );
}
