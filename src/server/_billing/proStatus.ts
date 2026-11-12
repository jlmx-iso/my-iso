import { Prisma } from "@prisma/client";

import {
  CANCELED_KEEPS_PAID_PERIOD,
  CANCELLATION_REQUESTED,
  entitlementsFor,
  PAST_DUE_GRACE_DAYS,
  type SubscriptionSnapshot,
} from "./entitlements";

/**
 * "Is this member Pro?" for OTHER people's names on a page (the Pro badge,
 * search placement), as opposed to the caller's own access (`proProcedure`).
 *
 * Two forms of the one rule in ./entitlements.ts:
 *
 * - `proUserIds`: a page of user ids at a time, from the stored rows,
 *   decided by `entitlementsFor` itself. One query per page (per 90 ids),
 *   never one per row. Unlike `proProcedure` it never syncs a row from
 *   Stripe first: a badge is not worth a Stripe call per name on a page.
 * - `proAccessSql`: the same rule as a SQL condition on a "Subscription"
 *   row, evaluated at read time, so a query can ORDER BY it (search). It is
 *   a mirror of `entitlementsFor`; proStatus.test.ts runs both over the same
 *   rows at several moments and fails if they ever disagree. Change both
 *   together.
 *
 * Neither stores anything: when a subscription lapses (cancellation date,
 * end of the past-due grace, end of a paid period), both stop counting the
 * member as Pro at that instant, without waiting for a sync.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** D1 binds at most 100 parameters per statement; keep well under it. */
const IDS_PER_QUERY = 90;

type ProStatusDb = {
  subscription: {
    findMany: (args: {
      where: { userId: { in: string[] } };
    }) => Promise<Array<SubscriptionSnapshot & { userId: string }>>;
  };
};

/** Which of `userIds` have Pro access at `now`. */
export async function proUserIds(
  db: ProStatusDb,
  userIds: Iterable<string>,
  now: Date = new Date(),
): Promise<Set<string>> {
  const unique = [...new Set(userIds)];
  const pro = new Set<string>();
  for (let start = 0; start < unique.length; start += IDS_PER_QUERY) {
    const rows = await db.subscription.findMany({
      where: { userId: { in: unique.slice(start, start + IDS_PER_QUERY) } },
    });
    for (const row of rows) {
      if (entitlementsFor(row, now).hasProAccess) pro.add(row.userId);
    }
  }
  return pro;
}

/**
 * `items` with `isPro` added to the person each one names (`userIdOf`), in
 * one batch. For payloads whose person is nested (an event's photographer),
 * see `withProOn`.
 */
export async function withPro<T>(
  db: ProStatusDb,
  items: readonly T[],
  userIdOf: (item: T) => string,
  now: Date = new Date(),
): Promise<Array<T & { isPro: boolean }>> {
  const pro = await proUserIds(db, items.map(userIdOf), now);
  return items.map((item) => ({ ...item, isPro: pro.has(userIdOf(item)) }));
}

/**
 * `items` with `isPro` added to the nested person under `key` (whose user
 * id is `userIdOf(person)`), in one batch.
 */
export async function withProOn<K extends string, T extends Record<K, object>>(
  db: ProStatusDb,
  items: readonly T[],
  key: K,
  userIdOf: (person: T[K]) => string,
  now: Date = new Date(),
): Promise<Array<WithProOn<T, K>>> {
  const pro = await proUserIds(db, items.map((item) => userIdOf(item[key])), now);
  return items.map((item) => {
    const person = item[key];
    return { ...item, [key]: { ...person, isPro: pro.has(userIdOf(person)) } };
  });
}

/** `T` whose `K` (a person) also says whether they are Pro. */
export type WithProOn<T, K extends keyof T> = Omit<T, K> & Record<K, T[K] & { isPro: boolean }>;

/**
 * A timestamp spelled exactly as Prisma stores one in SQLite / D1
 * ("2026-03-03T20:00:00.000+00:00"), so text comparison with a stored column
 * is comparison in time (docs/DATABASE.md, "Timestamps are text").
 */
export function storedTimestamp(date: Date): string {
  return date.toISOString().replace(/Z$/, "+00:00");
}

/**
 * SQL that is true when the "Subscription" row aliased `alias` grants Pro
 * access at `now`: `entitlementsFor(row, now).hasProAccess`, case for case.
 * False (not NULL) for a missing row of a LEFT JOIN. Binds four parameters.
 */
export function proAccessSql(alias: string, now: Date): Prisma.Sql {
  const s = (column: string) => Prisma.raw(`"${alias}"."${column}"`);
  const at = storedTimestamp(now);
  const graceCutoff = storedTimestamp(new Date(now.getTime() - PAST_DUE_GRACE_DAYS * DAY_MS));
  const canceledKeepsPaidPeriod = CANCELED_KEEPS_PAID_PERIOD
    ? Prisma.sql`(${s("status")} = 'canceled'
          AND ${s("cancellationReason")} = ${CANCELLATION_REQUESTED}
          AND ${s("paidThroughAt")} IS NOT NULL AND ${s("paidThroughAt")} > ${at}
          AND NOT (${s("refundedInvoiceId")} IS NOT NULL AND ${s("latestInvoiceId")} IS NOT NULL
                   AND ${s("refundedInvoiceId")} = ${s("latestInvoiceId")}))`
    : Prisma.sql`0`;

  return Prisma.sql`(${s("userId")} IS NOT NULL AND (
    ${s("isLifetime")} = 1
    OR (
      COALESCE(${s("disputeStatus")}, '') NOT IN ('open', 'lost')
      AND (
        (${s("status")} IN ('active', 'trialing')
          AND NOT (${s("cancelAtPeriodEnd")} = 1 AND ${s("cancelAt")} IS NOT NULL AND ${s("cancelAt")} <= ${at}))
        OR (${s("status")} = 'past_due' AND ${s("pastDueSince")} IS NOT NULL AND ${s("pastDueSince")} > ${graceCutoff})
        OR ${canceledKeepsPaidPeriod}
      )
    )
  ))`;
}
