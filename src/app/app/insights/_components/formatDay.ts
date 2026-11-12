const FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * "Jun 15" for a counter day ("2030-06-15"). The counters are kept per UTC
 * day, so the day is named as it is stored, never shifted into the viewer's
 * time zone (which would put a day's views under its neighbour).
 */
export function formatUtcDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? day : FORMAT.format(date);
}
