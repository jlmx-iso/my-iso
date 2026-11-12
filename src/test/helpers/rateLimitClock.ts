import { afterEach, beforeEach } from "vitest";

import {
  consumeRateLimit,
  otpVerifyLimits,
  setRateLimitClock,
  type RateLimitDb,
  type RateLimitPolicy,
} from "~/server/_utils/rateLimit";

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

/**
 * Puts a limit's counter where `count` requests would have left it, in one
 * statement (through the limiter itself, so key and window are the real
 * ones). Tests use it to get next to a limit and then make only the few real
 * requests that cross it: looping hundreds of real requests up to a limit is
 * slow, and a test that times out under load keeps running in the
 * background and moves the shared frozen clock under the tests after it.
 */
export async function spendRateLimit(
  db: RateLimitDb,
  policy: RateLimitPolicy,
  identifier: string,
  count: number,
): Promise<void> {
  if (count > 0) await consumeRateLimit(db, policy, identifier, { cost: count });
}

/** spendRateLimit for one of the sign-in code limits of (clientIp, email). */
export async function spendOtpVerifyLimit(
  db: RateLimitDb,
  policy: RateLimitPolicy,
  clientIp: string,
  email: string,
  count: number,
): Promise<void> {
  const check = otpVerifyLimits(clientIp, email).find((candidate) => candidate.policy.name === policy.name);
  if (!check) throw new Error(`${policy.name} is not a sign-in code limit`);
  await spendRateLimit(db, policy, check.identifier, count);
}
