/**
 * Conversation starters for a new match (`discover.getMatchById`). They are
 * written in the background after the match is made, so a match can be
 * opened before they exist: `pending` until they are stored, `unavailable`
 * when this deployment does not generate them.
 */
export type IcebreakersStatus = "ready" | "pending" | "unavailable";

/** How often to look again while suggestions are being written. */
export const ICEBREAKER_POLL_MS = 4_000;
/** How long to keep looking before giving up quietly. */
export const ICEBREAKER_WAIT_MS = 24_000;

/**
 * Delay before asking again, or false to stop: only while pending, and only
 * for a short while. `waitedMs` is how long we have been waiting so far.
 */
export function icebreakerPollInterval(status: string | undefined, waitedMs: number): number | false {
  if (status !== "pending") return false;
  return waitedMs < ICEBREAKER_WAIT_MS ? ICEBREAKER_POLL_MS : false;
}

/**
 * What to show: the suggestions once they are ready, a quiet "on their way"
 * line while we are still waiting for them, otherwise nothing.
 */
export function icebreakerView(
  match: { icebreakers?: readonly string[] | null; icebreakersStatus?: string } | undefined,
  waitedMs: number,
): { kind: "ready"; suggestions: string[] } | { kind: "pending" } | { kind: "hidden" } {
  if (!match) return { kind: "hidden" };
  const suggestions = (match.icebreakers ?? []).map((text) => text.trim()).filter(Boolean);
  if (match.icebreakersStatus === "ready" && suggestions.length > 0) return { kind: "ready", suggestions };
  if (icebreakerPollInterval(match.icebreakersStatus, waitedMs) !== false) return { kind: "pending" };
  return { kind: "hidden" };
}
