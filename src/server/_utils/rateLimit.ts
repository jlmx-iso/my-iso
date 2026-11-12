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

function rateLimitKey(policy: RateLimitPolicy, identifier: string): Promise<string> {
  return keyedHash("rate-limit", identifier).then((hash) => `${policy.name}:${hash}`);
}

/**
 * Gives back `cost` units counted in the current window, for a caller that
 * counted several at once (see `cost`) and then did not go ahead. Never
 * takes the counter below zero, and does nothing if the window has rolled
 * over since.
 */
export async function refundRateLimit(
  db: RateLimitDb,
  policy: RateLimitPolicy,
  identifier: string,
  cost: number,
  options: { nowMs?: number } = {},
): Promise<void> {
  const nowSeconds = Math.floor((options.nowMs ?? clock()) / 1000);
  const windowStart = nowSeconds - (nowSeconds % policy.windowSeconds);
  const key = await rateLimitKey(policy, identifier);
  await db.$executeRaw`
    UPDATE "RateLimit" SET "count" = MAX(0, "count" - ${cost})
    WHERE "key" = ${key} AND "windowStart" = ${windowStart}`;
}

/**
 * Counts one request (or `options.cost` units) against `policy` for
 * `identifier` and says whether it is
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
  options: { cost?: number; nowMs?: number; random?: () => number } = {},
): Promise<RateLimitResult> {
  const cost = options.cost ?? 1;
  if (!Number.isInteger(cost) || cost < 1) {
    throw new Error("Rate limit cost must be a positive integer");
  }
  const nowSeconds = Math.floor((options.nowMs ?? clock()) / 1000);
  const windowStart = nowSeconds - (nowSeconds % policy.windowSeconds);
  const expiresAt = windowStart + policy.windowSeconds;
  const key = await rateLimitKey(policy, identifier);

  const rows = await db.$queryRaw<Array<{ count: number | bigint }>>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count", "expiresAt")
    VALUES (${key}, ${windowStart}, ${cost}, ${expiresAt})
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "count" + ${cost}
    RETURNING "count"`;

  const count = Number(rows[0]?.count);
  if (!Number.isFinite(count)) {
    throw new Error("Rate limit statement returned no count");
  }

  // A count equal to the cost means this request opened a new window: a
  // cheap, naturally throttled moment to sweep old rows without a cron job.
  if (count === cost && (options.random ?? Math.random)() < CLEANUP_PROBABILITY) {
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
  options: { cost?: number } = {},
): Promise<RateLimitResult & { limiterFailed: boolean }> {
  try {
    return { ...(await consumeRateLimit(db, policy, identifier, options)), limiterFailed: false };
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
 * People one user may open NEW conversations with per day. A new one-to-one
 * thread counts once; a new group thread counts once per other participant,
 * so that group threads cannot multiply the reach of the cap (20 threads of
 * 10 would otherwise put one account in front of 180 people a day). Group
 * size itself stays generous (MAX_THREAD_PARTICIPANTS), because real groups
 * (a wedding team) are legitimate; it is the daily reach that is bounded.
 *
 * The single place this number lives: plans will make it depend on the
 * caller's subscription, by passing
 * `{ ...RateLimits.NEW_CONVERSATION_DAILY, limit }` to the limiter.
 */
export const MAX_NEW_CONVERSATIONS_PER_DAY = 20;

/** Every limit the app applies, in one place. */
export const RateLimits = {
  // Sign-in codes. Per-email limits bound guessing against one account and
  // mail sent to one inbox; per-IP limits bound one client spraying many.
  OTP_REQUEST_IP: { limit: 20, name: "otp-request-ip", onError: "deny", windowSeconds: 15 * MINUTE },
  // Codes one client may request for one address: the limits a person
  // asking for a new code can actually meet. Keyed on address AND client
  // for the same reason as the verify limits below: someone else requesting
  // codes for an address must not use up its owner's requests (the owner
  // could then not sign in by email for the rest of the window, or day).
  OTP_REQUEST_EMAIL_IP: { limit: 5, name: "otp-request-email-ip", onError: "deny", windowSeconds: 15 * MINUTE },
  OTP_REQUEST_EMAIL_IP_DAILY: { limit: 20, name: "otp-request-email-ip-daily", onError: "deny", windowSeconds: DAY },
  // Ceilings on codes requested for one address by ALL clients together:
  // what bounds the mail one inbox can be sent, and how often a distributed
  // guesser can get a fresh code. Three times the per-client limits, so one
  // client cannot reach them alone.
  OTP_REQUEST_EMAIL: { limit: 15, name: "otp-request-email", onError: "deny", windowSeconds: 15 * MINUTE },
  OTP_REQUEST_EMAIL_DAILY: { limit: 60, name: "otp-request-email-daily", onError: "deny", windowSeconds: DAY },
  OTP_VERIFY_IP: { limit: 30, name: "otp-verify-ip", onError: "deny", windowSeconds: 15 * MINUTE },
  // Guesses one client may make against one address: the limits a person
  // mistyping their code can actually meet. Keyed on address AND client, so
  // that someone else hammering an address does not use up its owner's
  // attempts (they would otherwise be locked out of email sign-in).
  OTP_VERIFY_EMAIL_IP: { limit: 10, name: "otp-verify-email-ip", onError: "deny", windowSeconds: 15 * MINUTE },
  OTP_VERIFY_EMAIL_IP_DAILY: { limit: 30, name: "otp-verify-email-ip-daily", onError: "deny", windowSeconds: DAY },
  // Ceilings on guesses against one address from ALL clients together, which
  // is what bounds a distributed guesser (a fresh code resets the per-code
  // attempt counter). Deliberately several times the per-client limits: one
  // client is stopped by its own limits long before it can fill these.
  OTP_VERIFY_EMAIL: { limit: 30, name: "otp-verify-email", onError: "deny", windowSeconds: 15 * MINUTE },
  OTP_VERIFY_EMAIL_DAILY: { limit: 100, name: "otp-verify-email-daily", onError: "deny", windowSeconds: DAY },
  MOBILE_TOKEN_EXCHANGE: { limit: 20, name: "mobile-token-exchange", onError: "deny", windowSeconds: 15 * MINUTE },

  // Invite codes and the waitlist (public, per IP).
  INVITE_VALIDATE: { limit: 10, name: "invite-validate", onError: "deny", windowSeconds: 5 * MINUTE },
  INVITE_PREPARE: { limit: 10, name: "invite-prepare", onError: "deny", windowSeconds: 5 * MINUTE },
  WAITLIST_SUBMIT: { limit: 5, name: "waitlist-submit", onError: "deny", windowSeconds: HOUR },
  // Confirmation emails re-sent to an address that is already on the list.
  WAITLIST_RECONFIRM_EMAIL: { limit: 1, name: "waitlist-reconfirm-email", onError: "deny", windowSeconds: DAY },

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
  MESSAGE_MARK_READ: { limit: 120, name: "message-mark-read", onError: "allow", windowSeconds: MINUTE },
  // Search-as-you-type: each has its own budget, sized for a person typing
  // (a debounced keystroke is a request, and the client retries failures),
  // so that one busy search box cannot starve the others.
  MEMBER_SEARCH: { limit: 90, name: "member-search", onError: "allow", windowSeconds: MINUTE },
  EVENT_SEARCH: { limit: 60, name: "event-search", onError: "allow", windowSeconds: MINUTE },
  RECIPIENT_SEARCH: { limit: 120, name: "recipient-search", onError: "allow", windowSeconds: MINUTE },
  // Opening a match (asks the AI provider for icebreakers).
  MATCH_DETAIL: { limit: 60, name: "match-detail", onError: "allow", windowSeconds: MINUTE },
  // Billing: each call talks to Stripe.
  BILLING_CHECKOUT: { limit: 10, name: "billing-checkout", onError: "allow", windowSeconds: HOUR },
  BILLING_PORTAL: { limit: 20, name: "billing-portal", onError: "allow", windowSeconds: HOUR },
  BILLING_SYNC: { limit: 6, name: "billing-sync", onError: "allow", windowSeconds: 5 * MINUTE },
  // Admin re-sync batches: up to RESYNC_MAX_BATCH rows each; what a batch
  // may cost in Stripe requests is bounded in _billing/resync.ts.
  BILLING_RESYNC: { limit: 120, name: "billing-resync", onError: "allow", windowSeconds: 5 * MINUTE },
  BOOKING_UPDATE: { limit: 60, name: "booking-update", onError: "allow", windowSeconds: HOUR },
  PLACES_AUTOCOMPLETE: { limit: 60, name: "places-autocomplete", onError: "allow", windowSeconds: MINUTE },
} as const satisfies Record<string, RateLimitPolicy>;

/**
 * Limits on asking for a sign-in code, in the order they must be checked:
 *
 * 1. the client (IP) across all addresses,
 * 2. this client for this address (15 minutes, then per day),
 * 3. the address across all clients (15 minutes, then per day).
 *
 * A refusal stops the chain, so a client that is over any of its own limits
 * never adds to the counters shared with the address's owner.
 */
export function otpRequestLimits(clientIp: string, email: string): RateLimitCheck[] {
  const emailAndIp = `email:${email}|ip:${clientIp}`;
  return [
    { identifier: `ip:${clientIp}`, policy: RateLimits.OTP_REQUEST_IP },
    { identifier: emailAndIp, policy: RateLimits.OTP_REQUEST_EMAIL_IP },
    { identifier: emailAndIp, policy: RateLimits.OTP_REQUEST_EMAIL_IP_DAILY },
    { identifier: `email:${email}`, policy: RateLimits.OTP_REQUEST_EMAIL },
    { identifier: `email:${email}`, policy: RateLimits.OTP_REQUEST_EMAIL_DAILY },
  ];
}

/**
 * Limits on submitting a sign-in code, in the order they must be checked:
 *
 * 1. the client (IP) across all addresses,
 * 2. this client against this address (15 minutes, then per day),
 * 3. the address across all clients (15 minutes, then per day).
 *
 * A refusal stops the chain, so a client that is over any of its own limits
 * never adds to the counters shared with the address's owner.
 */
export function otpVerifyLimits(clientIp: string, email: string): RateLimitCheck[] {
  const emailAndIp = `email:${email}|ip:${clientIp}`;
  return [
    { identifier: `ip:${clientIp}`, policy: RateLimits.OTP_VERIFY_IP },
    { identifier: emailAndIp, policy: RateLimits.OTP_VERIFY_EMAIL_IP },
    { identifier: emailAndIp, policy: RateLimits.OTP_VERIFY_EMAIL_IP_DAILY },
    { identifier: `email:${email}`, policy: RateLimits.OTP_VERIFY_EMAIL },
    { identifier: `email:${email}`, policy: RateLimits.OTP_VERIFY_EMAIL_DAILY },
  ];
}
