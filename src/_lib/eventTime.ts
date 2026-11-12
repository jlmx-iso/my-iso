/**
 * Event times, written in the event's own time zone and labelled with it:
 * "Sun, Nov 22 · 2:00 PM MST". An event happens somewhere, so 2 PM in
 * Denver is shown as 2 PM MST to a reader in New York too, never silently
 * converted. Events posted before their zone was recorded (`timeZone` null) are
 * written in the reader's zone, labelled "(your time)".
 *
 * Where many events are listed (feed and search cards) the label can be
 * left out when it says nothing new: the event's zone shows the same clock
 * as the reader's at that moment (`zone: "when-different"`).
 *
 * Plain Intl, no dependencies: used in client components and on the server
 * (the in-app notification when a booked event's time changes).
 */

export type EventTimeFormat =
  /** Nov 22, 2026 (cards, lists) */
  | "date"
  /** Sun, Nov 22 · 2:00 PM MST (the event page, where the weekday matters) */
  | "dayTime"
  /** Nov 22, 2026 · 2:00 PM MST (notifications) */
  | "dateTime"
  /** 2:00 PM MST */
  | "time"
  /** Sun, Nov 22 (the day only, e.g. for a screen reader next to "time") */
  | "weekdayDate";

export type EventTimeOptions = {
  /**
   * "always" (default): the zone is written after every time. "when-
   * different": only when the event's zone shows a different clock from the
   * reader's at that moment (and never for an event without a zone, which
   * is in the reader's zone anyway).
   */
  zone?: "always" | "when-different";
};

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

/**
 * A zone as the runtime spells it ("america/chicago" → "America/Chicago",
 * "US/Central" stays itself), or null for anything that is not a named IANA
 * zone: unknown names, and offsets ("+01:00", "UTC+1"), which say nothing
 * about daylight saving and so give the wrong time half the year.
 */
export function canonicalTimeZone(zone: string | null | undefined): string | null {
  if (!zone || !isValidTimeZone(zone.trim())) return null;
  const canonical = new Intl.DateTimeFormat("en-US", { timeZone: zone.trim() }).resolvedOptions().timeZone;
  return /^[A-Za-z]/.test(canonical) && !/^(?:UTC|GMT)[+-]/i.test(canonical) ? canonical : null;
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

/** Whether two zones show the same wall clock at `date`. */
function sameClock(date: Date, a: string | undefined, b: string | undefined): boolean {
  const pa = partsOf(date, a);
  const pb = partsOf(date, b);
  return pa.day === pb.day && pa.hour === pb.hour && pa.minute === pb.minute && pa.dayPeriod === pb.dayPeriod;
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
  { zone = "always" }: EventTimeOptions = {},
): string {
  if (date === null || date === undefined || date === "") return "";
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const eventZone = isValidTimeZone(timeZone) ? timeZone : undefined;
  const p = partsOf(value, eventZone);
  const day = `${p.month} ${p.day}`;
  const showZone = zone === "always" || (eventZone !== undefined && !sameClock(value, eventZone, undefined));
  const label = !showZone ? "" : eventZone ? ` ${p.timeZoneName}` : ` ${p.timeZoneName} (your time)`;
  const time = `${p.hour}:${p.minute} ${p.dayPeriod}${label}`;
  switch (format) {
    case "date":
      return `${day}, ${p.year}`;
    case "weekdayDate":
      return `${p.weekday}, ${day}`;
    case "dateTime":
      return `${day}, ${p.year} · ${time}`;
    case "time":
      return time;
    default:
      return `${p.weekday}, ${day} · ${time}`;
  }
}

/** The form's wall-clock format (the date picker's), as in ~/_utils/eventDates. */
const pad = (value: number) => String(value).padStart(2, "0");

/** The offset of `zone` from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: number, zone: string): number {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    minute: "numeric",
    month: "numeric",
    second: "numeric",
    timeZone: zone,
    year: "numeric",
  }).formatToParts(new Date(instant))) {
    parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a wall-clock time ("2026-11-22 14:00:00", as the date picker
 * gives it) names in `zone`. Null for an unreadable time or zone. A time
 * that a daylight-saving change skips lands an hour later, as clocks do.
 */
export function zonedWallTimeToDate(wall: string | null | undefined, zone: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wall ?? "");
  if (!match || !isValidTimeZone(zone)) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as [number, number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, Number.isNaN(s) ? 0 : s);
  // The zone's offset near that time, then once more at the result (the
  // offset can differ across a daylight-saving change).
  const first = asUtc - zoneOffsetMs(asUtc, zone);
  return new Date(asUtc - zoneOffsetMs(first, zone));
}

/** An instant as the wall-clock time in `zone`, in the date picker's format. */
export function dateToZonedWallTime(date: Date | string, zone: string | null | undefined): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const effective = isValidTimeZone(zone) ? zone : (localTimeZone() ?? "UTC");
  const local = new Date(value.getTime() + zoneOffsetMs(value.getTime(), effective));
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
}

/**
 * Time zones to choose from in the event form: a handful of common ones
 * first (with the browser's and the event's own), then every zone the
 * runtime knows. Each value appears once.
 */
export const COMMON_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

export function timeZoneChoices(
  include: ReadonlyArray<string | null | undefined>,
  now: Date = new Date(),
): Array<{ group: string; items: Array<{ label: string; value: string }> }> {
  const option = (zone: string) => ({ label: `${zone.replaceAll("_", " ")} (${timeZoneLabel(now, zone)})`, value: zone });
  const common = [...new Set([...include.filter(isValidTimeZone), ...COMMON_TIME_ZONES])];
  const all = Intl.supportedValuesOf("timeZone").filter((zone) => !common.includes(zone));
  return [
    { group: "Common", items: common.map(option) },
    { group: "All time zones", items: all.map(option) },
  ];
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
