import dayjs from "dayjs";

/** The form's date format (local time, as the date picker reads and writes it). */
export const EVENT_DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead an event may be: five years. The server's rule and the form both read this. */
export const EVENT_MAX_AHEAD_MS = 5 * 365 * DAY_MS;

/** The latest start the form (and the server) accepts. */
export function latestEventStart(now: Date = new Date()): Date {
  return new Date(now.getTime() + EVENT_MAX_AHEAD_MS);
}

/**
 * Where a new event's date starts: tomorrow at 10:00 local time. Never "now",
 * which the form (and the server) would refuse as soon as a second passed.
 */
export function defaultEventStart(now: Date = new Date()): string {
  return dayjs(now).add(1, "day").hour(10).minute(0).second(0).millisecond(0).format(EVENT_DATE_FORMAT);
}

/** The form's check of an event date: present, valid, in the future and within five years. Null when fine. */
export function eventDateError(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value || !dayjs(value).isValid()) return "Choose a date and time";
  if (!dayjs(value).isAfter(dayjs(now))) return "Choose a date and time in the future";
  return dayjs(value).isAfter(dayjs(latestEventStart(now))) ? "Choose a date within the next five years" : null;
}
