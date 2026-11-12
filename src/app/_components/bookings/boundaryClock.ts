import { useEffect, useState } from "react";

/**
 * A clock for a view whose content changes only at known moments (a booking
 * card: when the event starts and when it ends). It does not tick: it is
 * moved forward by ONE timeout, set for the nearest moment still ahead, and
 * set again for the next one after it has fired.
 */

/** The longest delay `setTimeout` takes (2^31 - 1 ms, about 24.8 days); longer ones fire at once. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/** Milliseconds from `nowMs` to the nearest boundary after it, or null when none is ahead. */
export function nextBoundaryDelay(boundaries: readonly Date[], nowMs: number): number | null {
  let nearest: number | null = null;
  for (const boundary of boundaries) {
    const delay = boundary.getTime() - nowMs;
    if (Number.isFinite(delay) && delay > 0 && (nearest === null || delay < nearest)) nearest = delay;
  }
  return nearest;
}

/**
 * Calls `onNow` with the current time each time a boundary has been
 * reached, for as long as boundaries lie ahead. Returns the function that
 * stops it (clears the pending timeout).
 *
 * A boundary further away than a timeout can wait is approached in steps;
 * a timeout that fires a moment early is simply followed by another for
 * the remainder. Either way `onNow` is called only once the boundary has
 * passed.
 */
export function startBoundaryClock(
  boundaries: readonly Date[],
  onNow: (now: Date) => void,
  clock: () => number = Date.now,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const arm = (waitingFor: number | null) => {
    if (stopped) return;
    const nowMs = clock();
    // The boundary this timeout was set for has been reached.
    if (waitingFor !== null && waitingFor <= nowMs) onNow(new Date(nowMs));
    const delay = nextBoundaryDelay(boundaries, nowMs);
    if (delay === null) return;
    const target = nowMs + delay;
    timer = setTimeout(() => arm(target), Math.min(delay, MAX_TIMEOUT_MS));
  };
  arm(null);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/**
 * The current time, advanced when one of `boundaries` is reached while the
 * component stays mounted. `boundaries` is compared by its times, so a new
 * array with the same dates does not restart the clock.
 */
export function useNowAtBoundaries(boundaries: readonly Date[]): Date {
  const [now, setNow] = useState(() => new Date());
  const key = boundaries.map((boundary) => boundary.getTime()).join(",");

  useEffect(() => {
    const times = key === "" ? [] : key.split(",").map((time) => new Date(Number(time)));
    // When the dates change under a mounted card, time has passed since
    // its clock was last read: read it again, then wait for boundaries.
    const reread = setTimeout(() => setNow(new Date()), 0);
    const stop = startBoundaryClock(times, setNow);
    return () => {
      clearTimeout(reread);
      stop();
    };
  }, [key]);

  return now;
}
