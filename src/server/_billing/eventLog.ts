import type { RateLimitDb } from "~/server/_utils/rateLimit";

/**
 * De-duplication of Stripe webhook deliveries (table StripeEvent).
 *
 * Stripe delivers an event at least once: the same event id can arrive
 * again after a timeout, and occasionally twice at the same moment. An
 * event is "claimed" before it is handled; the claim is one atomic
 * statement, so of any number of concurrent deliveries exactly one handles
 * the event.
 *
 *   claim ── handled ──▶ complete   (later deliveries: "duplicate", 200)
 *        └── failed ───▶ release    (Stripe retries; the retry claims again)
 *
 * A claim whose handler died without completing or releasing (the isolate
 * was evicted) expires after CLAIM_LEASE_SECONDS, so the event is not lost:
 * Stripe's next retry takes it over.
 */

/** The raw-query surface of any Prisma client. */
export type EventLogDb = RateLimitDb;

/** Longer than any handler can run (Stripe gives up on a delivery sooner). */
export const CLAIM_LEASE_SECONDS = 60;

/** Stripe retries a failed delivery for up to three days; keep ids well past that. */
const RETENTION_SECONDS = 30 * 24 * 60 * 60;

/** Share of claims that also delete rows past retention. */
const CLEANUP_PROBABILITY = 0.01;

export type EventClaim =
  /** This delivery handles the event. Pass the token to complete/release. */
  | { claimedAt: number; status: "claimed" }
  /** Already handled: acknowledge and do nothing. */
  | { status: "duplicate" }
  /** Another delivery is handling it right now: ask Stripe to retry. */
  | { status: "in_progress" };

type ClaimOptions = { nowMs?: number; random?: () => number };

export async function claimStripeEvent(
  db: EventLogDb,
  event: { created: number; id: string; type: string },
  options: ClaimOptions = {},
): Promise<EventClaim> {
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const leaseExpired = now - CLAIM_LEASE_SECONDS;

  // Inserts the claim, or takes over a claim whose lease ran out. Returns a
  // row only if this statement is the one that now holds the claim.
  const claimed = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "StripeEvent" ("id", "type", "status", "eventCreated", "claimedAt")
    VALUES (${event.id}, ${event.type}, 'processing', ${event.created}, ${now})
    ON CONFLICT ("id") DO UPDATE SET "claimedAt" = excluded."claimedAt"
      WHERE "StripeEvent"."status" = 'processing' AND "StripeEvent"."claimedAt" <= ${leaseExpired}
    RETURNING "id"`;

  if (claimed.length > 0) {
    if ((options.random ?? Math.random)() < CLEANUP_PROBABILITY) {
      await purgeOldStripeEvents(db, now * 1000).catch(() => undefined);
    }
    return { claimedAt: now, status: "claimed" };
  }

  const existing = await db.$queryRaw<Array<{ status: string }>>`
    SELECT "status" FROM "StripeEvent" WHERE "id" = ${event.id}`;
  // No row: the holder released it between the two statements; let Stripe
  // retry rather than guess.
  return existing[0]?.status === "processed" ? { status: "duplicate" } : { status: "in_progress" };
}

/** Marks a claimed event as handled. */
export async function completeStripeEvent(
  db: EventLogDb,
  eventId: string,
  claimedAt: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const processedAt = Math.floor(nowMs / 1000);
  await db.$executeRaw`
    UPDATE "StripeEvent" SET "status" = 'processed', "processedAt" = ${processedAt}
    WHERE "id" = ${eventId} AND "status" = 'processing' AND "claimedAt" = ${claimedAt}`;
}

/** Gives up a claim after a failure, so that the retry can claim the event. */
export async function releaseStripeEvent(
  db: EventLogDb,
  eventId: string,
  claimedAt: number,
): Promise<void> {
  await db.$executeRaw`
    DELETE FROM "StripeEvent"
    WHERE "id" = ${eventId} AND "status" = 'processing' AND "claimedAt" = ${claimedAt}`;
}

/** Deletes event ids older than the retention period. Returns the number removed. */
export function purgeOldStripeEvents(db: EventLogDb, nowMs: number = Date.now()): Promise<number> {
  const cutoff = Math.floor(nowMs / 1000) - RETENTION_SECONDS;
  return db.$executeRaw`DELETE FROM "StripeEvent" WHERE "claimedAt" <= ${cutoff}`;
}
