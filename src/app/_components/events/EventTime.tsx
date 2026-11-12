"use client";

import { useSyncExternalStore } from "react";

import { type EventTimeFormat, formatEventTime } from "~/_lib/eventTime";

type EventTimeProps = {
    date: Date | string;
    /** The event's IANA zone; null for older events (the reader's zone is used). */
    timeZone: string | null | undefined;
    format?: EventTimeFormat;
};

function subscribeToNothing() {
    return () => undefined;
}

/**
 * An event's start, in the event's own time zone and labelled with it
 * ("Sun, Nov 22 · 2:00 PM MST"). Written in the browser only, like
 * LocalDate: an event without a zone is shown in the reader's, which the
 * server does not know, and the zone names come from the browser's own
 * time zone data.
 */
export default function EventTime({ date, timeZone, format = "dayTime" }: EventTimeProps) {
    const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);
    if (!isClient) return null;
    const text = formatEventTime(date, timeZone, format);
    return text ? <time dateTime={new Date(date).toISOString()}>{text}</time> : null;
}
