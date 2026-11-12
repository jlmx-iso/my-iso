import { afterEach, beforeEach } from "vitest";

import { setRateLimitClock } from "~/server/_utils/rateLimit";

/**
 * Midnight UTC, which is the start of a window for every window length the
 * limiter uses (they all divide a day), so a test has the whole window ahead
 * of it.
 */
export const RATE_LIMIT_TEST_EPOCH_MS = Date.UTC(2030, 0, 1);

/**
 * Pins the rate limiter's clock for every test in the calling file or
 * `describe` block, so counting up to a limit can never straddle a window
 * boundary. Time only moves when a test calls `advance`.
 */
export function freezeRateLimitClock() {
  let nowMs = RATE_LIMIT_TEST_EPOCH_MS;
  let restore: (() => void) | undefined;

  beforeEach(() => {
    nowMs = RATE_LIMIT_TEST_EPOCH_MS;
    restore = setRateLimitClock(() => nowMs);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  return {
    advance(seconds: number) {
      nowMs += seconds * 1000;
    },
    now: () => nowMs,
  };
}
