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
 * lease is not interrupted: keep the TTL above the longest the sequence can
 * take.
 */

export type LeaseDb = RateLimitDb;

export type LeaseOptions = {
  /** The clock in milliseconds, for tests. */
  now?: () => number;
  /** Pause between attempts, for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** How long the lease is held at most before others may take it over. */
  ttlSeconds: number;
  /** How long to keep trying to take the lease. */
  waitMs: number;
};

/** The lease could not be taken in time: someone else is still at work. */
export class LeaseBusyError extends Error {
  constructor(key: string) {
    super(`Billing lease "${key}" is held by another request`);
    this.name = "LeaseBusyError";
  }
}

const RETRY_EVERY_MS = 150;

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
  work: () => Promise<T>,
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const holder = crypto.randomUUID();
  const deadline = now() + options.waitMs;

  for (;;) {
    if (await tryAcquire(db, key, holder, Math.floor(now() / 1000), options.ttlSeconds)) break;
    if (now() >= deadline) throw new LeaseBusyError(key);
    await sleep(RETRY_EVERY_MS);
  }

  try {
    return await work();
  } finally {
    await db.$executeRaw`
      DELETE FROM "BillingLease" WHERE "key" = ${key} AND "holder" = ${holder}`.catch(() => undefined);
  }
}
