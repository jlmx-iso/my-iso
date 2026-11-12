import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";

dayjs.extend(relativeTime);
dayjs.extend(utc);

export default dayjs;

/**
 * Every way the app writes a date. One list, so "Jun 14, 2026" does not
 * appear next to "June 14th" or "14/06/2026" on another screen.
 *
 * - `date`: Jun 14, 2026 (lists, cards, receipts)
 * - `dateLong`: June 14, 2026 (prose: "You reviewed Ada on …")
 * - `dateTime`: Jun 14, 2026 3:30 PM (exact moments: tooltips, bookings)
 * - `dayTime`: Sun, Jun 14 · 3:30 PM (an upcoming event, where the weekday matters)
 * - `time`: 3:30 PM
 */
export const DATE_FORMATS = {
  date: "MMM D, YYYY",
  dateLong: "MMMM D, YYYY",
  dateTime: "MMM D, YYYY h:mm A",
  dayTime: "ddd, MMM D · h:mm A",
  time: "h:mm A",
} as const;

export type DateFormatName = keyof typeof DATE_FORMATS;

type DateInput = Date | string | number | null | undefined;

/**
 * A date in the reader's own time zone, in one of the named formats. Empty
 * string for a missing or unparseable date, so callers can render it as is.
 */
export function formatDate(date: DateInput, format: DateFormatName = "date"): string {
  if (date === null || date === undefined || date === "") return "";
  const value = dayjs(date);
  if (!value.isValid()) return "";
  return value.format(DATE_FORMATS[format]);
}

/** "2 hours ago", "in 3 days". Empty string for a missing or invalid date. */
export function formatRelative(date: DateInput, now?: DateInput): string {
  if (date === null || date === undefined || date === "") return "";
  const value = dayjs(date);
  if (!value.isValid()) return "";
  return now === undefined || now === null ? value.fromNow() : value.from(dayjs(now));
}
