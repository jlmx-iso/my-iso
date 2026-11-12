/**
 * Countdowns for "resend in 30s" style controls, kept apart from React so
 * the timing can be tested.
 */

/** How often the countdown looks at the clock. */
const TICK_MS = 250;

/** Whole seconds left until `endsAt` (rounded up), never negative. */
export function cooldownRemaining(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/**
 * Starts a countdown of `seconds`. `onTick` is called at once with the full
 * time and then as it runs down, ending with 0. Returns a function that
 * stops it early (no further calls).
 *
 * The remaining time is read from the clock on every tick rather than
 * counted down: a background tab whose timers are throttled shows the right
 * number as soon as it runs again.
 */
export function startCooldown(
  seconds: number,
  onTick: (remaining: number) => void,
  now: () => number = Date.now,
): () => void {
  const endsAt = now() + seconds * 1000;
  let last = cooldownRemaining(endsAt, now());
  onTick(last);
  if (last === 0) return () => undefined;

  const timer = setInterval(() => {
    const left = cooldownRemaining(endsAt, now());
    if (left !== last) {
      last = left;
      onTick(left);
    }
    if (left === 0) clearInterval(timer);
  }, TICK_MS);
  return () => clearInterval(timer);
}
