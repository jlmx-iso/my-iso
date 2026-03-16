import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";

dayjs.extend(relativeTime);
dayjs.extend(utc);

export default dayjs;

/** Convert a UTC date to the user's local timezone and format it. */
export function formatLocalDate(
  date: Date | string | null | undefined,
  format = "MMM D, YYYY",
): string {
  if (!date) return "";
  return dayjs(date).utc().local().format(format);
}

/** Convert a UTC date to local timezone with time included. */
export function formatLocalDateTime(
  date: Date | string | null | undefined,
): string {
  if (!date) return "";
  return dayjs(date).utc().local().format("MMM D, YYYY h:mm A");
}