import dayjs from "dayjs";

/** The form's date format (local time, as the date picker reads and writes it). */
export const EVENT_DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";

/**
 * Where a new event's date starts: tomorrow at 10:00 local time. Never "now",
 * which the form (and the server) would refuse as soon as a second passed.
 */
export function defaultEventStart(now: Date = new Date()): string {
  return dayjs(now).add(1, "day").hour(10).minute(0).second(0).millisecond(0).format(EVENT_DATE_FORMAT);
}

/** The form's check of an event date: present, valid, and in the future. Null when fine. */
export function eventDateError(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value || !dayjs(value).isValid()) return "Choose a date and time";
  return dayjs(value).isAfter(dayjs(now)) ? null : "Choose a date and time in the future";
}
