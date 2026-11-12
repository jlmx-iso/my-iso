import { Prisma } from "@prisma/client";

import { isViewSource, VIEW_SOURCES, type InsightRange, type ViewSource } from "~/_utils/viewSources";
import { storedTimestamp } from "~/server/_billing/proStatus";
import { utcDay } from "~/server/_lib/viewCounter";

import type { ExtendedPrismaClient } from "./softDelete";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many of the member's events the insights page lists. */
export const TOP_EVENTS = 10;

/**
 * A source with fewer views than this in the period is folded into
 * "other": with one or two views from, say, Messages, the member could
 * guess who looked.
 */
export const MIN_SOURCE_COUNT = 3;

/** A number for the period, and the same number for the period before it. */
export type Compared = {
  value: number;
  /** The previous period of the same length; null when it was not (fully) counted. */
  previous: number | null;
  /** Whole-percent change from `previous`; null when there is nothing to compare with (null or 0). */
  changePercent: number | null;
};

export type Insights = {
  days: InsightRange;
  /**
   * First and last UTC day of the period ("YYYY-MM-DD"), both included. The
   * period ends YESTERDAY: today is still being counted, and a number that
   * moves while the member watches could be tied to one visitor.
   */
  from: string;
  to: string;
  /**
   * The first day views were counted at all on ISO (the earliest counter
   * row; today when nothing has been counted yet). Days before it were not
   * counted, which is not the same as nobody looking.
   */
  countingSince: string;
  profileViews: Compared & {
    /** One entry per day, oldest first, zeros included; starts no earlier than countingSince. */
    daily: Array<{ day: string; count: number }>;
    /** Sources, most first; any with fewer than MIN_SOURCE_COUNT views are counted under "other". */
    sources: Array<{ source: ViewSource; count: number }>;
  };
  /** Views of the member's own live events. */
  eventViews: Compared;
  /** Applications to the member's own live events. */
  applications: Compared;
  /** Conversations someone else started with the member (they sent its first message). */
  conversationsStarted: Compared;
  /** The member's events with the most views (then applications) in the period. */
  topEvents: Array<{ id: string; title: string; date: Date; views: number; applications: number }>;
};

type InsightsDb = Pick<ExtendedPrismaClient, "$queryRaw" | "booking" | "event" | "eventView" | "profileView">;

const startOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The `days` complete UTC days ending yesterday (relative to `now`), oldest first. */
export function rangeDays(days: number, now: Date): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => utcDay(new Date(today - (days - index) * DAY_MS)));
}

export function compare(value: number, previous: number | null): Compared {
  const changePercent = previous ? Math.round(((value - previous) / previous) * 100) : null;
  return { changePercent, previous, value };
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** Views per source, with the small ones under "other", most first. */
export function foldSources(bySource: ReadonlyMap<ViewSource, number>): Array<{ source: ViewSource; count: number }> {
  let other = 0;
  const kept: Array<{ source: ViewSource; count: number }> = [];
  for (const source of VIEW_SOURCES) {
    const count = bySource.get(source) ?? 0;
    if (count === 0) continue;
    if (source === "other" || count < MIN_SOURCE_COUNT) other += count;
    else kept.push({ count, source });
  }
  if (other > 0) kept.push({ count: other, source: "other" });
  return kept.sort((a, b) => b.count - a.count);
}

/**
 * Conversations in which someone other than `userId` sent the first
 * message, with that first message in [since, until). Soft-deleted messages
 * are deliberately NOT ignored when deciding who started a thread (this is
 * raw SQL, outside the soft-delete extension, on purpose): deleting a first
 * message later does not change who wrote first, nor move the conversation
 * into another period.
 */
async function conversationsStartedWith(db: InsightsDb, userId: string, since: Date, until: Date): Promise<number> {
  const rows = await db.$queryRaw<Array<{ n: number | bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS "n" FROM "Message" m
    WHERE m."threadId" IN (SELECT "A" FROM "_MessageThreadToUser" WHERE "B" = ${userId})
      AND m."senderId" <> ${userId}
      AND m."createdAt" >= ${storedTimestamp(since)}
      AND m."createdAt" < ${storedTimestamp(until)}
      AND NOT EXISTS (
        SELECT 1 FROM "Message" e
        WHERE e."threadId" = m."threadId"
          AND (e."createdAt" < m."createdAt" OR (e."createdAt" = m."createdAt" AND e."id" < m."id"))
      )`);
  // COUNT(*) answers one row.
  return rows.reduce((total, row) => total + Number(row.n), 0);
}

/** The first day anything was counted (the counters began with this feature). */
async function countingStarted(db: InsightsDb): Promise<string | null> {
  const [profile, event] = await Promise.all([
    db.profileView.findFirst({ orderBy: { day: "asc" }, select: { day: true } }),
    db.eventView.findFirst({ orderBy: { day: "asc" }, select: { day: true } }),
  ]);
  const days = [profile?.day, event?.day].filter((day): day is string => Boolean(day)).sort();
  return days[0] ?? null;
}

/**
 * The member's numbers for the `days` complete UTC days ending yesterday,
 * each with the same number for the period before. Counts only, never who:
 * the view tables hold no viewer, small sources are folded together, and
 * nothing from today is shown.
 */
export async function getInsights(db: InsightsDb, userId: string, days: InsightRange, now: Date = new Date()): Promise<Insights> {
  const range = rangeDays(days, now);
  // [since, until): the `days` complete UTC days ending yesterday.
  const until = startOfDay(utcDay(now));
  const since = new Date(until.getTime() - days * DAY_MS);
  const from = utcDay(since);
  const to = utcDay(new Date(until.getTime() - DAY_MS));
  const previousFrom = utcDay(new Date(since.getTime() - days * DAY_MS));
  const previousSince = startOfDay(previousFrom);
  const ownLiveEvent = { isDeleted: false, photographer: { userId } };
  const applicationsWhere = (gte: Date, lt: Date) => ({
    createdAt: { gte, lt },
    event: { isDeleted: false },
    isDeleted: false,
    ownerId: userId,
  });

  const [countingStartedOn, profileRows, eventViewRows, applicationRows, previousApplications, conversations, previousConversations] =
    await Promise.all([
      countingStarted(db),
      db.profileView.findMany({
        select: { count: true, day: true, source: true },
        where: { day: { gte: previousFrom, lte: to }, userId },
      }),
      db.eventView.groupBy({
        _sum: { count: true },
        by: ["eventId", "day"],
        where: { day: { gte: previousFrom, lte: to }, event: ownLiveEvent },
      }),
      db.booking.groupBy({ _count: { _all: true }, by: ["eventId"], where: applicationsWhere(since, until) }),
      db.booking.count({ where: applicationsWhere(previousSince, since) }),
      conversationsStartedWith(db, userId, since, until),
      conversationsStartedWith(db, userId, previousSince, since),
    ]);

  const countingSince = countingStartedOn ?? utcDay(now);
  const byDay = new Map<string, number>();
  const bySource = new Map<ViewSource, number>();
  let previousProfileViews = 0;
  for (const row of profileRows) {
    if (row.day < from) {
      previousProfileViews += row.count;
      continue;
    }
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.count);
    const source = isViewSource(row.source) ? row.source : "other";
    bySource.set(source, (bySource.get(source) ?? 0) + row.count);
  }
  // The chart starts when counting did: days before that were not counted,
  // which is not the same as nobody looking.
  const daily = range.filter((day) => day >= countingSince).map((day) => ({ count: byDay.get(day) ?? 0, day }));
  // The previous period can only be compared when it was counted in full.
  const previousCounted = countingSince <= previousFrom;

  const viewsByEvent = new Map<string, number>();
  let previousEventViews = 0;
  for (const row of eventViewRows) {
    // A sum over at least one row: never null here; Number(null) would be 0.
    const count = Number(row._sum.count);
    if (row.day < from) previousEventViews += count;
    else viewsByEvent.set(row.eventId, (viewsByEvent.get(row.eventId) ?? 0) + count);
  }
  const applicationsByEvent = new Map(applicationRows.map((row) => [row.eventId, row._count._all]));
  const ranked = [...new Set([...viewsByEvent.keys(), ...applicationsByEvent.keys()])]
    .map((id) => ({ applications: applicationsByEvent.get(id) ?? 0, id, views: viewsByEvent.get(id) ?? 0 }))
    .sort((a, b) => b.views - a.views || b.applications - a.applications || a.id.localeCompare(b.id))
    .slice(0, TOP_EVENTS);
  const events = ranked.length
    ? await db.event.findMany({
        select: { date: true, id: true, title: true },
        where: { id: { in: ranked.map((row) => row.id) }, ...ownLiveEvent },
      })
    : [];
  const eventById = new Map(events.map((event) => [event.id, event]));

  return {
    applications: compare(sum(applicationsByEvent.values()), previousApplications),
    conversationsStarted: compare(conversations, previousConversations),
    countingSince,
    days,
    eventViews: compare(sum(viewsByEvent.values()), previousCounted ? previousEventViews : null),
    from,
    profileViews: {
      ...compare(sum(byDay.values()), previousCounted ? previousProfileViews : null),
      daily,
      sources: foldSources(bySource),
    },
    to,
    // An id with no live event of the member's (deleted since) is dropped.
    topEvents: ranked.flatMap((row) => {
      const event = eventById.get(row.id);
      return event ? [{ ...row, date: event.date, title: event.title }] : [];
    }),
  };
}
