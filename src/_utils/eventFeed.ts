import { type Page, mergePages } from "./pagination";

/** Events fetched per "page" of the feed. */
export const EVENTS_PAGE_SIZE = 12;

/** The two lists of the events feed. */
export type FeedWhen = "upcoming" | "past";

export function isFeedWhen(value: unknown): value is FeedWhen {
  return value === "upcoming" || value === "past";
}

export type FeedView<T> = {
  /** Every loaded event, in the server's order, each one once. */
  events: T[];
  /** Whether "Load more" has somewhere to go. */
  hasMore: boolean;
  /** "Showing 24 events" while more can be loaded; null when all are shown. */
  note: string | null;
};

/**
 * What the feed shows for the pages loaded so far. The server orders each
 * list (upcoming: soonest first; past: most recent first) and says whether
 * there is another page, so nothing is sorted or counted here: the list can
 * be any length.
 */
export function feedView<T extends { id: string }>(pages: ReadonlyArray<Page<T>> | undefined): FeedView<T> {
  const events = mergePages(pages);
  const hasMore = (pages?.at(-1)?.nextCursor ?? null) !== null;
  return {
    events,
    hasMore,
    note: hasMore ? `Showing ${events.length} ${events.length === 1 ? "event" : "events"}` : null,
  };
}
