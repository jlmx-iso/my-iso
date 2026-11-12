import { Prisma } from "@prisma/client";

import type { ViewSource } from "~/_utils/viewSources";

/**
 * Daily view counters for Pro insights (tables "ProfileView" and
 * "EventView", migrations/0005).
 *
 * Privacy, by construction:
 * - One row per (profile, UTC day, source) or (event, UTC day) holding a
 *   count. Nothing about the viewer is stored: not an id, an address, a user
 *   agent or the referring URL. The source is a fixed category derived from
 *   the PATH of a referrer on this site; any other site is just "external".
 * - The owner looking at their own profile or event is not counted.
 * - Requests that say they are a bot, crawler or link preview are not
 *   counted, nor are router prefetches (a link coming into view is not a
 *   visit).
 *
 * Each count is one atomic statement (INSERT ... ON CONFLICT DO UPDATE SET
 * count = count + 1): concurrent views never lose an increment, and D1 needs
 * no transaction for it.
 */

/**
 * User agents that announce automation. Deliberately simple: it only has
 * to keep the obvious crawlers, link unfurlers and headless tools out of a
 * member's numbers.
 */
const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|preview|fetch|scan|monitor|headless|lighthouse|phantom|python|curl|wget|httpclient|okhttp|axios|node-fetch|go-http|java\/|facebookexternalhit|embedly|quora link|whatsapp|vkshare|pinterest|bitly/i;

/** Whether a request looks automated. No user agent at all counts as automated. */
export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 10) return true;
  return BOT_USER_AGENT.test(userAgent);
}

/** "2030-06-15": the UTC day of `date`, the unit the counters are kept in. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Where a view came from, from the request's Referer: only its path is
 * looked at, and only when it is this site (`ownOrigin`). Never stored as
 * given.
 */
export function viewSourceFromReferer(referer: string | null | undefined, ownOrigin: string): ViewSource {
  if (!referer) return "direct";
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return "direct";
  }
  if (url.origin !== new URL(ownOrigin).origin) return "external";

  const path = url.pathname;
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (under("/app/search")) return "search";
  if (under("/app/events")) return "event";
  if (under("/app/discover")) return "discover";
  if (under("/app/messages")) return "messages";
  if (under("/app/bookings")) return "bookings";
  if (under("/app/photographer") || under("/photographer") || under("/app/profile")) return "profile";
  return "other";
}

export type ViewRequest = {
  /** Who is looking (null: signed out). Used only to skip self-views. */
  viewerId: string | null;
  userAgent: string | null;
  referer: string | null;
  /** The request is a router prefetch, not a visit. */
  isPrefetch: boolean;
};

export type ViewOutcome = "counted" | "self" | "bot" | "prefetch" | "refresh";

type ViewCounterDb = {
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
};

function skipReason(request: ViewRequest, ownerId: string): Exclude<ViewOutcome, "counted" | "refresh"> | null {
  if (request.isPrefetch) return "prefetch";
  if (request.viewerId !== null && request.viewerId === ownerId) return "self";
  if (isLikelyBot(request.userAgent)) return "bot";
  return null;
}

/** The path of a same-origin referrer, else null. */
function sameOriginPath(referer: string | null, ownOrigin: string): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    return url.origin === new URL(ownOrigin).origin ? url.pathname : null;
  } catch {
    return null;
  }
}

/**
 * Counts one view of the profile of `profileUserId`, unless it is the
 * owner's own, automated, a prefetch, or a re-render of the same page (a
 * refresh after an action on it: the referrer is the page itself).
 */
export async function recordProfileView(
  db: ViewCounterDb,
  args: { profileUserId: string; pagePaths: readonly string[]; ownOrigin: string; now?: Date } & ViewRequest,
): Promise<ViewOutcome> {
  const skip = skipReason(args, args.profileUserId);
  if (skip) return skip;
  const from = sameOriginPath(args.referer, args.ownOrigin);
  if (from !== null && args.pagePaths.includes(from)) return "refresh";

  const source = viewSourceFromReferer(args.referer, args.ownOrigin);
  const day = utcDay(args.now ?? new Date());
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "ProfileView" ("userId", "day", "source", "count") VALUES (${args.profileUserId}, ${day}, ${source}, 1)
    ON CONFLICT ("userId", "day", "source") DO UPDATE SET "count" = "count" + 1`);
  return "counted";
}

/** Counts one view of event `eventId` (owned by `ownerId`), on the same terms. */
export async function recordEventView(
  db: ViewCounterDb,
  args: { eventId: string; ownerId: string; pagePath: string; ownOrigin: string; now?: Date } & ViewRequest,
): Promise<ViewOutcome> {
  const skip = skipReason(args, args.ownerId);
  if (skip) return skip;
  if (sameOriginPath(args.referer, args.ownOrigin) === args.pagePath) return "refresh";

  const day = utcDay(args.now ?? new Date());
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "EventView" ("eventId", "day", "count") VALUES (${args.eventId}, ${day}, 1)
    ON CONFLICT ("eventId", "day") DO UPDATE SET "count" = "count" + 1`);
  return "counted";
}
