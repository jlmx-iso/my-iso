import { Prisma } from "@prisma/client";

import type { RateLimitDb } from "~/server/_utils/rateLimit";

/**
 * Short database leases (table BillingLease) that make a multi-step
 * sequence against Stripe run for one user at a time. D1 has no
 * transactions or row locks to hold across awaits, so mutual exclusion is a
 * row: taking the lease is ONE conditional upsert, which of any number of
 * concurrent callers exactly one wins.
 *
 * A lease carries an expiry, so a holder that died (the isolate was evicted)
 * blocks nobody for longer than `ttlSeconds`. A holder that outlives its
 * lease is not interrupted, so the work is handed a LeaseHandle and makes
 * the step that must not happen twice depend on still holding it: either
 * `renew()` immediately before the step (a conditional update: it fails once
 * someone else has taken the lease over, and otherwise gives the step a
 * full TTL), or a write that carries `heldCondition()` in its own WHERE
 * clause, which is atomic.
 */

export type LeaseDb = RateLimitDb;

export type LeaseOptions = {
  /** The clock in milliseconds, for tests. */
  now?: () => number;
  /** Decides whether this acquisition also sweeps old rows (see purgeExpiredLeases); for tests. */
  random?: () => number;
  /** Pause between attempts, for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** How long the lease is held at most before others may take it over. */
  ttlSeconds: number;
  /** How long to keep trying to take the lease. */
  waitMs: number;
};

/** What the holder of a lease can do with it while it works. */
export type LeaseHandle = {
  /**
   * SQL condition, for the WHERE clause of a write, that is true only while
   * this holder still has the lease: the write and the check are then ONE
   * statement.
   */
  heldCondition: () => Prisma.Sql;
  key: string;
  /**
   * Extends the lease by a full TTL if this holder still has it. False when
   * another request has taken it over (this one ran past its expiry): the
   * caller must stop before doing anything that the new holder also does.
   */
  renew: () => Promise<boolean>;
};

/** The lease could not be taken in time: someone else is still at work. */
export class LeaseBusyError extends Error {
  constructor(key: string) {
    super(`Billing lease "${key}" is held by another request`);
    this.name = "LeaseBusyError";
  }
}

/** The holder ran past its lease and another request took it over. */
export class LeaseLostError extends LeaseBusyError {
  constructor(key: string) {
    super(key);
    this.message = `Billing lease "${key}" expired and was taken over by another request`;
    this.name = "LeaseLostError";
  }
}

/**
 * Pauses between attempts to take a busy lease: short at first (most
 * holders are done within a few hundred milliseconds), doubling up to a
 * second. Each attempt is one D1 statement, so a waiter costs about seven
 * statements over 3.5 s and about fourteen over 10 s, not one every 150 ms.
 */
const FIRST_RETRY_MS = 150;
const MAX_RETRY_MS = 1000;

export const retryDelayMs = (attempt: number): number =>
  Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempt - 1));

/** Share of acquisitions that also delete long-expired rows. */
const CLEANUP_PROBABILITY = 0.02;
/**
 * Only rows expired for this long are swept: a holder that overran its
 * lease by a moment can still renew it (nobody took it over), and must not
 * lose it to housekeeping.
 */
const PURGE_GRACE_SECONDS = 60 * 60;

/**
 * Deletes leases and claims that expired more than PURGE_GRACE_SECONDS ago:
 * what crashed holders left behind, and first-sync claims of rows that have
 * long been settled. An expired row means nothing (anyone may take the key),
 * so removing it changes no outcome. Returns how many were removed.
 */
export function purgeExpiredLeases(db: LeaseDb, nowMs: number = Date.now()): Promise<number> {
  const before = Math.floor(nowMs / 1000) - PURGE_GRACE_SECONDS;
  return db.$executeRaw`DELETE FROM "BillingLease" WHERE "expiresAt" <= ${before}`;
}

/** After a successful acquisition, now and then: never fails the caller. */
async function maybePurge(db: LeaseDb, nowMs: number, random: () => number): Promise<void> {
  if (random() >= CLEANUP_PROBABILITY) return;
  await purgeExpiredLeases(db, nowMs).catch(() => undefined);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function tryAcquire(db: LeaseDb, key: string, holder: string, nowSeconds: number, ttlSeconds: number): Promise<boolean> {
  const expiresAt = nowSeconds + ttlSeconds;
  const rows = await db.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "BillingLease" ("key", "holder", "expiresAt")
    VALUES (${key}, ${holder}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "holder" = excluded."holder", "expiresAt" = excluded."expiresAt"
      WHERE "BillingLease"."expiresAt" <= ${nowSeconds}
    RETURNING "holder"`;
  return rows[0]?.holder === holder;
}

/**
 * Runs `work` while holding the lease `key`, waiting up to `waitMs` for it.
 * The lease is released when `work` settles, whether it succeeded or threw
 * (a failed release is harmless: the lease expires). Throws LeaseBusyError
 * if the lease could not be taken.
 */
export async function withLease<T>(
  db: LeaseDb,
  key: string,
  options: LeaseOptions,
  work: (lease: LeaseHandle) => Promise<T>,
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const holder = crypto.randomUUID();
  const deadline = now() + options.waitMs;

  for (let attempt = 1; ; attempt += 1) {
    if (await tryAcquire(db, key, holder, Math.floor(now() / 1000), options.ttlSeconds)) break;
    const remaining = deadline - now();
    if (remaining <= 0) throw new LeaseBusyError(key);
    // Never past the deadline: the last attempt is made when the wait ends.
    await sleep(Math.min(retryDelayMs(attempt), remaining));
  }
  await maybePurge(db, now(), options.random ?? Math.random);

  const handle: LeaseHandle = {
    heldCondition: () =>
      Prisma.sql`EXISTS (SELECT 1 FROM "BillingLease" WHERE "key" = ${key} AND "holder" = ${holder})`,
    key,
    renew: async () => {
      const expiresAt = Math.floor(now() / 1000) + options.ttlSeconds;
      const renewed = await db.$executeRaw`
        UPDATE "BillingLease" SET "expiresAt" = ${expiresAt} WHERE "key" = ${key} AND "holder" = ${holder}`;
      return renewed > 0;
    },
  };

  try {
    return await work(handle);
  } finally {
    await db.$executeRaw`
      DELETE FROM "BillingLease" WHERE "key" = ${key} AND "holder" = ${holder}`.catch(() => undefined);
  }
}

/**
 * Takes `key` for `ttlSeconds` WITHOUT a holder that releases it: a durable
 * "not again before" marker, for work that should be attempted at most once
 * per period across all isolates (the lazy first sync of a legacy row).
 * True when this caller got it; false while an earlier claim is running.
 * `extendClaim` moves the expiry of a claim that exists.
 */
export async function claimFor(
  db: LeaseDb,
  key: string,
  ttlSeconds: number,
  nowMs: number = Date.now(),
  random: () => number = Math.random,
): Promise<boolean> {
  const claimed = await tryAcquire(db, key, crypto.randomUUID(), Math.floor(nowMs / 1000), ttlSeconds);
  if (claimed) await maybePurge(db, nowMs, random);
  return claimed;
}

export async function extendClaim(
  db: LeaseDb,
  key: string,
  ttlSeconds: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
  await db.$executeRaw`UPDATE "BillingLease" SET "expiresAt" = ${expiresAt} WHERE "key" = ${key}`;
}
