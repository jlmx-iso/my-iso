import { Prisma } from "@prisma/client";

import { isViewSource, VIEW_SOURCES, type InsightRange, type ViewSource } from "~/_utils/viewSources";
import { storedTimestamp } from "~/server/_billing/proStatus";
import { utcDay } from "~/server/_lib/viewCounter";

import type { ExtendedPrismaClient } from "./softDelete";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many of the member's events the insights page lists. */
export const TOP_EVENTS = 10;

export type Insights = {
  days: InsightRange;
  /** First and last UTC day of the range ("YYYY-MM-DD"), both included. */
  from: string;
  to: string;
  profileViews: {
    total: number;
    /** One entry per day of the range, oldest first, zeros included. */
    daily: Array<{ day: string; count: number }>;
    /** Sources with at least one view, most first. */
    sources: Array<{ source: ViewSource; count: number }>;
  };
  /** Views of the member's own (live) events. */
  eventViews: number;
  /** Applications to the member's own (live) events. */
  applications: number;
  /** Conversations someone else started with the member (their first message). */
  conversationsStarted: number;
  /** The member's events with the most views (then applications) in the range. */
  topEvents: Array<{ id: string; title: string; date: Date; views: number; applications: number }>;
};

type InsightsDb = Pick<ExtendedPrismaClient, "$queryRaw" | "booking" | "event" | "eventView" | "profileView">;

/** The UTC days of the `days`-day range ending on `now`'s day, oldest first. */
export function rangeDays(days: number, now: Date): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => utcDay(new Date(today - (days - 1 - index) * DAY_MS)));
}

/**
 * The member's numbers for the last `days` days (today included, in UTC
 * days). Counts only, never who: the view tables hold no viewer, and the
 * application and conversation counts return numbers, not people.
 */
export async function getInsights(db: InsightsDb, userId: string, days: InsightRange, now: Date = new Date()): Promise<Insights> {
  const range = rangeDays(days, now);
  const from = range[0] ?? utcDay(now);
  const to = range.at(-1) ?? utcDay(now);
  const since = new Date(`${from}T00:00:00.000Z`);
  const ownLiveEvent = { isDeleted: false, photographer: { userId } };

  const [profileRows, eventViewRows, applicationRows, conversations] = await Promise.all([
    db.profileView.findMany({
      select: { count: true, day: true, source: true },
      where: { day: { gte: from }, userId },
    }),
    db.eventView.groupBy({
      _sum: { count: true },
      by: ["eventId"],
      where: { day: { gte: from }, event: ownLiveEvent },
    }),
    db.booking.groupBy({
      _count: { _all: true },
      by: ["eventId"],
      where: { createdAt: { gte: since }, event: { isDeleted: false }, isDeleted: false, ownerId: userId },
    }),
    // A conversation "started with" the member: a thread they are in whose
    // first message (in (createdAt, id) order) someone else sent, in range.
    db.$queryRaw<Array<{ n: number | bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS "n" FROM "Message" m
      WHERE m."threadId" IN (SELECT "A" FROM "_MessageThreadToUser" WHERE "B" = ${userId})
        AND m."senderId" <> ${userId}
        AND m."createdAt" >= ${storedTimestamp(since)}
        AND NOT EXISTS (
          SELECT 1 FROM "Message" e
          WHERE e."threadId" = m."threadId"
            AND (e."createdAt" < m."createdAt" OR (e."createdAt" = m."createdAt" AND e."id" < m."id"))
        )`),
  ]);

  const byDay = new Map<string, number>();
  const bySource = new Map<ViewSource, number>();
  for (const row of profileRows) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.count);
    const source = isViewSource(row.source) ? row.source : "other";
    bySource.set(source, (bySource.get(source) ?? 0) + row.count);
  }
  const daily = range.map((day) => ({ count: byDay.get(day) ?? 0, day }));

  const viewsByEvent = new Map(eventViewRows.map((row) => [row.eventId, row._sum.count ?? 0]));
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
    applications: sum(applicationsByEvent.values()),
    conversationsStarted: Number(conversations[0]?.n ?? 0),
    days,
    eventViews: sum(viewsByEvent.values()),
    from,
    profileViews: {
      daily,
      sources: VIEW_SOURCES.flatMap((source) => {
        const count = bySource.get(source) ?? 0;
        return count > 0 ? [{ count, source }] : [];
      }).sort((a, b) => b.count - a.count),
      total: sum(byDay.values()),
    },
    to,
    topEvents: ranked.flatMap((row) => {
      const event = eventById.get(row.id);
      return event ? [{ ...row, date: event.date, title: event.title }] : [];
    }),
  };
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
