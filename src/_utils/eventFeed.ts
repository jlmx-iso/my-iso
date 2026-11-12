/** Events fetched per "page" of the feed. */
export const EVENTS_PAGE_SIZE = 12;

/**
 * Splits a page of events into what is still to come and what has happened.
 * The feed query returns events newest-date-first with no date filter, so the
 * client decides what to call "upcoming".
 */
export function partitionEventsByDate<T extends { date: Date | string }>(
  events: readonly T[],
  now: Date = new Date(),
): { upcoming: T[]; past: T[] } {
  const time = (event: T) => new Date(event.date).getTime();
  const upcoming = events
    .filter((event) => time(event) >= now.getTime())
    // Soonest first: the next gig is the most useful one.
    .sort((a, b) => time(a) - time(b));
  const past = events
    .filter((event) => time(event) < now.getTime())
    // Most recent first.
    .sort((a, b) => time(b) - time(a));
  return { past, upcoming };
}
