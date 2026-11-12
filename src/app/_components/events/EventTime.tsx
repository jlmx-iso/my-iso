"use client";

import { useSyncExternalStore } from "react";

import { type EventTimeFormat, type EventTimeOptions, formatEventTime } from "~/_lib/eventTime";

type EventTimeProps = {
    date: Date | string;
    /** The event's IANA zone; null for older events (the reader's zone is used). */
    timeZone: string | null | undefined;
    format?: EventTimeFormat;
    /** When to write the zone (see formatEventTime); always, by default. */
    zone?: EventTimeOptions["zone"];
};

/** About as wide as each format's text, so nothing moves when it appears. */
const PLACEHOLDER_WIDTH: Record<EventTimeFormat, string> = {
    date: "11ch",
    dateTime: "22ch",
    dayTime: "21ch",
    time: "11ch",
    weekdayDate: "10ch",
};

function subscribeToNothing() {
    return () => undefined;
}

/**
 * An event's start, in the event's own time zone and labelled with it
 * ("Sun, Nov 22 · 2:00 PM MST"). Written in the browser only, like
 * LocalDate: an event without a zone is shown in the reader's, which the
 * server does not know, and the zone names come from the browser's own
 * time zone data. Until then it holds the text's width, empty.
 */
export default function EventTime({ date, timeZone, format = "dayTime", zone = "always" }: EventTimeProps) {
    const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);
    if (!isClient) {
        return <span style={{ display: "inline-block", minWidth: PLACEHOLDER_WIDTH[format] }} data-testid="event-time-placeholder" />;
    }
    const text = formatEventTime(date, timeZone, format, { zone });
    return text ? <time dateTime={new Date(date).toISOString()}>{text}</time> : null;
}
