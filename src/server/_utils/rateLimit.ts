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

/** Share of newly opened windows that also sweep expired rows. */
const CLEANUP_PROBABILITY = 0.02;

/** Deletes counters whose window has ended. Returns the number removed. */
export function purgeExpiredRateLimits(
  db: RateLimitDb,
  nowMs: number = Date.now(),
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
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
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
  const result = await checkRateLimit(db, policy, identifier);
  if (result.allowed) return;

  if (result.limiterFailed) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Temporarily unavailable. Please try again shortly.",
    });
  }

  logger.warn("Rate limit exceeded", { policy: policy.name });
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Too many requests. Try again in ${result.retryAfter}s.`,
  });
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/** Every limit the app applies, in one place. */
export const RateLimits = {
  // Sign-in codes. Per-email limits bound guessing against one account and
  // mail sent to one inbox; per-IP limits bound one client spraying many.
  OTP_REQUEST_EMAIL: { limit: 5, name: "otp-request-email", onError: "deny", windowSeconds: 15 * MINUTE },
  OTP_REQUEST_IP: { limit: 20, name: "otp-request-ip", onError: "deny", windowSeconds: 15 * MINUTE },
  OTP_VERIFY_EMAIL: { limit: 10, name: "otp-verify-email", onError: "deny", windowSeconds: 15 * MINUTE },
  OTP_VERIFY_IP: { limit: 30, name: "otp-verify-ip", onError: "deny", windowSeconds: 15 * MINUTE },
  MOBILE_TOKEN_EXCHANGE: { limit: 20, name: "mobile-token-exchange", onError: "deny", windowSeconds: 15 * MINUTE },

  // Invite codes and the waitlist (public, per IP).
  INVITE_VALIDATE: { limit: 10, name: "invite-validate", onError: "deny", windowSeconds: 5 * MINUTE },
  INVITE_PREPARE: { limit: 10, name: "invite-prepare", onError: "deny", windowSeconds: 5 * MINUTE },
  WAITLIST_SUBMIT: { limit: 5, name: "waitlist-submit", onError: "deny", windowSeconds: HOUR },

  // Signed-in activity (per user).
  MESSAGE_SEND: { limit: 60, name: "message-send", onError: "allow", windowSeconds: MINUTE },
  THREAD_CREATE: { limit: 20, name: "thread-create", onError: "allow", windowSeconds: HOUR },
  SWIPE: { limit: 120, name: "swipe", onError: "allow", windowSeconds: MINUTE },
  EVENT_CREATE: { limit: 20, name: "event-create", onError: "allow", windowSeconds: HOUR },
  COMMENT_CREATE: { limit: 30, name: "comment-create", onError: "allow", windowSeconds: 5 * MINUTE },
  REVIEW_CREATE: { limit: 10, name: "review-create", onError: "allow", windowSeconds: HOUR },
  UPLOAD: { limit: 40, name: "upload", onError: "allow", windowSeconds: HOUR },
  SEARCH: { limit: 60, name: "search", onError: "allow", windowSeconds: MINUTE },
  PLACES_AUTOCOMPLETE: { limit: 60, name: "places-autocomplete", onError: "allow", windowSeconds: MINUTE },
} as const satisfies Record<string, RateLimitPolicy>;
