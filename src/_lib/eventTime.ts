/**
 * Event times, written in the event's own time zone and labelled with it:
 * "Sun, Nov 22 · 2:00 PM MST". An event happens somewhere, so 2 PM in
 * Denver is shown as 2 PM MST to a reader in New York too, never silently
 * converted. Events posted before their zone was recorded (`timeZone` null)
 * are written in the reader's zone, still labelled, so the reader can tell.
 *
 * Plain Intl, no dependencies: used in client components and in emails.
 */

export type EventTimeFormat =
  /** Nov 22, 2026 (cards, lists) */
  | "date"
  /** Sun, Nov 22 · 2:00 PM MST (the event page, where the weekday matters) */
  | "dayTime"
  /** Nov 22, 2026 · 2:00 PM MST (bookings, emails) */
  | "dateTime"
  /** 2:00 PM MST */
  | "time";

/** Whether `zone` is an IANA time zone this runtime knows. */
export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's (or server's) own IANA zone, or null if it has none. */
export function localTimeZone(): string | null {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(zone) ? zone : null;
}

type Parts = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

function partsOf(date: Date, timeZone: string | undefined): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    month: "short",
    timeZone,
    timeZoneName: "short",
    weekday: "short",
    year: "numeric",
  }).formatToParts(date);
  const result: Parts = {};
  for (const part of parts) result[part.type] = part.value;
  return result;
}

/**
 * An event's date or time in its zone (see the module comment). Empty
 * string for a missing or invalid date. An unknown zone falls back to the
 * reader's.
 */
export function formatEventTime(
  date: Date | string | number | null | undefined,
  timeZone: string | null | undefined,
  format: EventTimeFormat = "dayTime",
): string {
  if (date === null || date === undefined || date === "") return "";
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const p = partsOf(value, isValidTimeZone(timeZone) ? timeZone : undefined);
  const day = `${p.month} ${p.day}`;
  const time = `${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
  switch (format) {
    case "date":
      return `${day}, ${p.year}`;
    case "dateTime":
      return `${day}, ${p.year} · ${time}`;
    case "time":
      return time;
    default:
      return `${p.weekday}, ${day} · ${time}`;
  }
}

/**
 * Month ("Nov") and day ("22") of an event's start in its zone, for a
 * calendar-style date tile. Null for an invalid date.
 */
export function eventDay(
  date: Date | string,
  timeZone: string | null | undefined,
): { day: string; month: string; weekday: string } | null {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  const p = partsOf(value, isValidTimeZone(timeZone) ? timeZone : undefined);
  return { day: p.day ?? "", month: p.month ?? "", weekday: p.weekday ?? "" };
}

/**
 * The zone's short name at that moment ("MST", "GMT+1"), for a label next
 * to a time picker. Empty string for an invalid date.
 */
export function timeZoneLabel(date: Date, timeZone: string | null | undefined): string {
  if (Number.isNaN(date.getTime())) return "";
  return partsOf(date, isValidTimeZone(timeZone) ? timeZone : undefined).timeZoneName ?? "";
}
