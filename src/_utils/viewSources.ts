/**
 * Where a profile view came from, as Pro insights reports it. Fixed
 * categories derived from the path of a referrer on this site (see
 * src/server/_lib/viewCounter.ts); never a URL, never a person. Shared by the
 * server (which records them) and the insights page (which names them).
 */
export const VIEW_SOURCES = ["search", "event", "discover", "messages", "bookings", "profile", "external", "direct", "other"] as const;
export type ViewSource = (typeof VIEW_SOURCES)[number];

/** How the insights page names each source. */
export const VIEW_SOURCE_LABELS: Record<ViewSource, string> = {
  bookings: "Bookings",
  direct: "Direct or shared link",
  discover: "Discover",
  event: "Events",
  external: "Other websites",
  messages: "Messages",
  other: "Other",
  profile: "Other profiles",
  search: "Search",
};

export function isViewSource(value: string): value is ViewSource {
  return VIEW_SOURCES.some((source) => source === value);
}

/** The ranges the insights page offers, in days. */
export const INSIGHT_RANGES = [7, 30, 90] as const;
export type InsightRange = (typeof INSIGHT_RANGES)[number];
