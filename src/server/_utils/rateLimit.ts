/**
 * Rate limiting backed by the application database (Cloudflare D1 in
 * production, SQLite locally and in tests).
 *
 * Fixed-window counters: one row per (key, window). Each check is a single
 * atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement, so
 * concurrent requests can never read the same count and both pass.
 *
 * Usage in a tRPC procedure (see `rateLimit` in ~/server/api/trpc):
 *
 *   protectedProcedure.use(rateLimit(RateLimits.MESSAGE_SEND))
 *
 * or, when the identifier comes from the input (an email address):
 *
 *   await enforceRateLimit(ctx.db, RateLimits.OTP_REQUEST_EMAIL, email);
 */

import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { logger } from "~/_utils";

import { keyedHash } from "./hash";

export type RateLimitPolicy = {
  /** Bucket name; part of the stored key. */
  name: string;
  /** Maximum number of requests allowed in one window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /**
   * What to do when the limiter itself fails (database error).
   * "deny" for anything an attacker gains from if limits silently vanish
   * (sign-in codes, invite codes); "allow" where availability matters more.
   */
  onError: "allow" | "deny";
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type RateLimitResult = {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Seconds until the current window ends */
  retryAfter: number;
};

/** The two raw-query methods the limiter needs; any Prisma client has them. */
export type RateLimitDb = {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Prisma.PrismaPromise<T>;
  $executeRaw: (
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Prisma.PrismaPromise<number>;
};

let clock: () => number = Date.now;

/**
 * Replaces the clock every limiter call reads (milliseconds since the epoch)
 * and returns a function that puts the previous one back. For tests: windows
 * are fixed slices of wall-clock time, so a test that counts up to a limit
 * with the real clock fails whenever it straddles a window boundary.
 */
export function setRateLimitClock(now: () => number): () => void {
  const previous = clock;
  clock = now;
  return () => {
    clock = previous;
  };
}

/** Share of newly opened windows that also sweep expired rows. */
const CLEANUP_PROBABILITY = 0.02;

/** Deletes counters whose window has ended. Returns the number removed. */
export function purgeExpiredRateLimits(
  db: RateLimitDb,
  nowMs: number = clock(),
): Promise<number> {
  const nowSeconds = Math.floor(nowMs / 1000);
  return db.$executeRaw`DELETE FROM "RateLimit" WHERE "expiresAt" <= ${nowSeconds}`;
}

/**
 * Counts one request against `policy` for `identifier` and says whether it is
 * within the limit. Throws if the database call fails; callers that want the
 * policy's `onError` behaviour use `enforceRateLimit`.
 *
 * `identifier` (user id, IP address, email address) is never stored: the key
 * holds a keyed hash of it.
 */
export async function consumeRateLimit(
  db: RateLimitDb,
  policy: RateLimitPolicy,
  identifier: string,
  options: { nowMs?: number; random?: () => number } = {},
): Promise<RateLimitResult> {
  const nowSeconds = Math.floor((options.nowMs ?? clock()) / 1000);
  const windowStart = nowSeconds - (nowSeconds % policy.windowSeconds);
  const expiresAt = windowStart + policy.windowSeconds;
  const key = `${policy.name}:${await keyedHash("rate-limit", identifier)}`;

  const rows = await db.$queryRaw<Array<{ count: number | bigint }>>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count", "expiresAt")
    VALUES (${key}, ${windowStart}, 1, ${expiresAt})
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "count" + 1
    RETURNING "count"`;

  const count = Number(rows[0]?.count);
  if (!Number.isFinite(count)) {
    throw new Error("Rate limit statement returned no count");
  }

  // A count of 1 means this request opened a new window: a cheap, naturally
  // throttled moment to sweep old rows without a cron job.
  if (count === 1 && (options.random ?? Math.random)() < CLEANUP_PROBABILITY) {
    try {
      await purgeExpiredRateLimits(db, nowSeconds * 1000);
    } catch (error) {
      logger.warn("Rate limit cleanup failed", { error });
    }
  }

  const allowed = count <= policy.limit;
  return {
    allowed,
    remaining: Math.max(0, policy.limit - count),
    retryAfter: allowed ? 0 : Math.max(1, expiresAt - nowSeconds),
  };
}

/**
 * Like `consumeRateLimit`, but resolves limiter failures according to the
 * policy: "deny" reports the request as not allowed, "allow" lets it through.
 */
export async function checkRateLimit(
  db: RateLimitDb,
  policy: RateLimitPolicy,
  identifier: string,
): Promise<RateLimitResult & { limiterFailed: boolean }> {
  try {
    return { ...(await consumeRateLimit(db, policy, identifier)), limiterFailed: false };
  } catch (error) {
    logger.error("Rate limiter failed", {
      error,
      failMode: policy.onError,
      policy: policy.name,
    });
    return {
      allowed: policy.onError === "allow",
      limiterFailed: true,
      remaining: 0,
      retryAfter: policy.onError === "allow" ? 0 : 30,
    };
  }
}

export type RateLimitCheck = { identifier: string; policy: RateLimitPolicy };

/**
 * Checks several limits one after the other and stops at the first that
 * refuses, so the limits after it are NOT counted.
 *
 * Order matters: put the limit keyed on something the caller controls (their
 * IP address) before one keyed on something they merely name (an email
 * address). Checked the other way round, or in parallel, a client that is
 * already blocked could keep spending someone else's per-email allowance and
 * lock them out of signing in.
 */
export async function checkRateLimitsInOrder(
  db: RateLimitDb,
  checks: readonly RateLimitCheck[],
): Promise<(RateLimitResult & { limiterFailed: boolean; policy: RateLimitPolicy }) | null> {
  for (const { identifier, policy } of checks) {
    const result = await checkRateLimit(db, policy, identifier);
    if (!result.allowed) return { ...result, policy };
  }
  return null;
}

/**
 * Counts one request and throws a tRPC error when it is over the limit
 * (TOO_MANY_REQUESTS, HTTP 429) or when the limiter failed under a "deny"
 * policy (SERVICE_UNAVAILABLE, HTTP 503).
 */
export async function enforceRateLimit(
  db: RateLimitDb,
  policy: RateLimitPolicy,
  identifier: string,
): Promise<void> {
  await enforceRateLimitsInOrder(db, [{ identifier, policy }]);
}

/** Seconds as "45 seconds", "12 minutes" or "3 hours", rounded up. */
function describeWait(seconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (seconds < MINUTE) return plural(seconds, "second");
  if (seconds < HOUR) return plural(Math.ceil(seconds / MINUTE), "minute");
  return plural(Math.ceil(seconds / HOUR), "hour");
}

/**
 * `enforceRateLimit` for several limits, with the ordering guarantee of
 * `checkRateLimitsInOrder`: a refusal stops before the remaining limits are
 * counted.
 */
export async function enforceRateLimitsInOrder(
  db: RateLimitDb,
  checks: readonly RateLimitCheck[],
): Promise<void> {
  const result = await checkRateLimitsInOrder(db, checks);
  if (!result) return;
  const { policy } = result;

  if (result.limiterFailed) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Temporarily unavailable. Please try again shortly.",
    });
  }

  logger.warn("Rate limit exceeded", { policy: policy.name });
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Too many requests. Try again in ${describeWait(result.retryAfter)}.`,
  });
}


/**
 * New conversations (threads that did not exist before) one user may open
 * per day. The single place this number lives: plans will make it depend on
 * the caller's subscription, by passing
 * `{ ...RateLimits.NEW_CONVERSATION_DAILY, limit }` to the limiter.
 */
export const MAX_NEW_CONVERSATIONS_PER_DAY = 20;

/** Every limit the app applies, in one place. */
export const RateLimits = {
  // Sign-in codes. Per-email limits bound guessing against one account and
  // mail sent to one inbox; per-IP limits bound one client spraying many.
  OTP_REQUEST_EMAIL: { limit: 5, name: "otp-request-email", onError: "deny", windowSeconds: 15 * MINUTE },
  OTP_REQUEST_IP: { limit: 20, name: "otp-request-ip", onError: "deny", windowSeconds: 15 * MINUTE },
  OTP_VERIFY_EMAIL: { limit: 10, name: "otp-verify-email", onError: "deny", windowSeconds: 15 * MINUTE },
  OTP_VERIFY_IP: { limit: 30, name: "otp-verify-ip", onError: "deny", windowSeconds: 15 * MINUTE },
  // Per-day caps on top of the 15-minute ones. A fresh code resets the
  // per-code attempt counter, so without these the 15-minute verify limit
  // alone would allow about 960 guesses a day against one address.
  OTP_REQUEST_EMAIL_DAILY: { limit: 20, name: "otp-request-email-daily", onError: "deny", windowSeconds: DAY },
  OTP_VERIFY_EMAIL_DAILY: { limit: 30, name: "otp-verify-email-daily", onError: "deny", windowSeconds: DAY },
  MOBILE_TOKEN_EXCHANGE: { limit: 20, name: "mobile-token-exchange", onError: "deny", windowSeconds: 15 * MINUTE },

  // Invite codes and the waitlist (public, per IP).
  INVITE_VALIDATE: { limit: 10, name: "invite-validate", onError: "deny", windowSeconds: 5 * MINUTE },
  INVITE_PREPARE: { limit: 10, name: "invite-prepare", onError: "deny", windowSeconds: 5 * MINUTE },
  WAITLIST_SUBMIT: { limit: 5, name: "waitlist-submit", onError: "deny", windowSeconds: HOUR },

  // Signed-in activity (per user).
  MESSAGE_SEND: { limit: 60, name: "message-send", onError: "allow", windowSeconds: MINUTE },
  // Every message.createThread call, including ones that land in an existing
  // thread. Deliberately looser than NEW_CONVERSATION_DAILY, which is the
  // limit a person actually meets and has its own error reason.
  THREAD_CREATE: { limit: 60, name: "thread-create", onError: "allow", windowSeconds: HOUR },
  NEW_CONVERSATION_DAILY: { limit: MAX_NEW_CONVERSATIONS_PER_DAY, name: "new-conversation-daily", onError: "allow", windowSeconds: DAY },
  SWIPE: { limit: 120, name: "swipe", onError: "allow", windowSeconds: MINUTE },
  EVENT_CREATE: { limit: 20, name: "event-create", onError: "allow", windowSeconds: HOUR },
  COMMENT_CREATE: { limit: 30, name: "comment-create", onError: "allow", windowSeconds: 5 * MINUTE },
  BOOKING_APPLY: { limit: 20, name: "booking-apply", onError: "allow", windowSeconds: HOUR },
  REVIEW_CREATE: { limit: 10, name: "review-create", onError: "allow", windowSeconds: HOUR },
  UPLOAD: { limit: 40, name: "upload", onError: "allow", windowSeconds: HOUR },
  SEARCH: { limit: 60, name: "search", onError: "allow", windowSeconds: MINUTE },
  PLACES_AUTOCOMPLETE: { limit: 60, name: "places-autocomplete", onError: "allow", windowSeconds: MINUTE },
} as const satisfies Record<string, RateLimitPolicy>;

/**
 * Limits on asking for a sign-in code, in the order they must be checked:
 * the requesting client first, then the address it names.
 */
export function otpRequestLimits(clientIp: string, email: string): RateLimitCheck[] {
  return [
    { identifier: `ip:${clientIp}`, policy: RateLimits.OTP_REQUEST_IP },
    { identifier: `email:${email}`, policy: RateLimits.OTP_REQUEST_EMAIL },
    { identifier: `email:${email}`, policy: RateLimits.OTP_REQUEST_EMAIL_DAILY },
  ];
}

/** Limits on submitting a sign-in code; same ordering as otpRequestLimits. */
export function otpVerifyLimits(clientIp: string, email: string): RateLimitCheck[] {
  return [
    { identifier: `ip:${clientIp}`, policy: RateLimits.OTP_VERIFY_IP },
    { identifier: `email:${email}`, policy: RateLimits.OTP_VERIFY_EMAIL },
    { identifier: `email:${email}`, policy: RateLimits.OTP_VERIFY_EMAIL_DAILY },
  ];
}
