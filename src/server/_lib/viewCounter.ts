import { Prisma } from "@prisma/client";

import type { ViewSource } from "~/_utils/viewSources";
import { keyedHash, timingSafeEqualStrings } from "~/server/_utils/hash";

/**
 * Daily view counters for Pro insights (tables "ProfileView" and
 * "EventView", migrations/0005). The rules, also in docs/DATABASE.md:
 *
 * Privacy, by construction:
 * - One row per (profile, UTC day, source) or (event, UTC day) holding a
 *   count. Nothing about the viewer is stored with it: not an id, an
 *   address, a user agent or the referring URL. The source is a fixed
 *   category derived from the PATH of a referrer on this site; any other
 *   site is just "external".
 * - The dedupe cookie (VIEW_COOKIE) lives only in the viewer's browser and
 *   holds the UTC day and short keyed hashes of what that browser has
 *   already been counted for today, signed so it cannot be forged. No
 *   identity, no profile ids in the clear; it expires at the end of the day.
 * - "ViewSeen" holds one opaque keyed hash of (viewer, target, day) until
 *   the day is over (purge-expired deletes it), the viewer being the
 *   signed-in member or, signed out, the client address (an IPv6 /64): it
 *   can confirm a guess with the server's secret, never list who looked.
 *
 * Counting, bounded:
 * - A view is counted by a request the page makes once it is on screen
 *   (POST /api/views), so crawlers that do not run JavaScript never count.
 * - At most once per viewer, per target, per UTC day: per signed-in member
 *   on any device, per client address when signed out (both ViewSeen), and
 *   per browser (the cookie, which answers repeats without the database).
 * - Never the owner's own (signed in), never a bot user agent.
 * - Every write is first admitted by rate limiters that write nothing to
 *   the database (Cloudflare's Rate Limiting binding; in memory off
 *   Cloudflare): per signed-in member or, signed out, per client address
 *   (an IPv6 /64), and for signed-out views also one cap shared by all of
 *   them. A client that discards or replays the cookie is held to those
 *   limits, so anonymous traffic can write at most VIEW_ANON_LIMIT counts a
 *   period per Cloudflare location, whatever addresses it uses.
 *
 * Each count is one atomic statement (INSERT ... ON CONFLICT DO UPDATE SET
 * count = count + 1): concurrent views never lose an increment, and D1 needs
 * no transaction for it.
 */

/** The dedupe cookie's name. Scoped to /api/views; HttpOnly. */
export const VIEW_COOKIE = "iso_views";

/** How many targets one browser is counted for per day; beyond that, no more counts. */
export const VIEW_COOKIE_MAX_TARGETS = 40;

/**
 * Counted views admitted per minute per member or client address (per
 * Cloudflare location). wrangler.toml's VIEW_COUNT_LIMIT must say the same.
 */
export const VIEW_RATE_LIMIT = { limit: 20, periodSeconds: 60 } as const;

/**
 * Signed-out views admitted per minute in all, whoever sends them (per
 * Cloudflare location): the hard bound on what anonymous traffic can write.
 * wrangler.toml's VIEW_ANON_LIMIT must say the same.
 */
export const VIEW_ANON_LIMIT = { limit: 120, periodSeconds: 60 } as const;

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
 * Where a view came from, from the page request's Referer: only its path is
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
  // URL lowercases the scheme and host and drops default ports, on both sides.
  if (url.origin !== new URL(ownOrigin).origin) return "external";

  const path = normalizedPath(url.pathname);
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (under("/app/search")) return "search";
  if (under("/app/events")) return "event";
  if (under("/app/discover")) return "discover";
  if (under("/app/messages")) return "messages";
  if (under("/app/bookings")) return "bookings";
  if (under("/app/photographer") || under("/photographer") || under("/app/profile")) return "profile";
  return "other";
}

/** A path compared as the router would serve it: percent-decoded, lower case, no trailing slash. */
function normalizedPath(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A malformed escape: compare it as written.
  }
  path = path.toLowerCase();
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

// ---------------------------------------------------------------------------
// The source token
// ---------------------------------------------------------------------------

/**
 * How long after midnight UTC yesterday's source token is still accepted:
 * a page rendered at 23:59 reports its view a moment later, on the next day.
 */
export const VIEW_SOURCE_TOKEN_GRACE_MS = 10 * 60 * 1000;

/**
 * The token a page passes to its ViewBeacon with the source the server
 * worked out: a keyed hash (AUTH_SECRET) of kind, target, source and UTC
 * day. The endpoint trusts `source` only with a token that matches, so a
 * client cannot file a view under a category of its choosing.
 */
export async function viewSourceToken(target: ViewTarget, source: ViewSource, day: string): Promise<string> {
  return (await keyedHash("view-source", `${target.kind}|${target.id}|${source}|${day}`)).slice(0, 32);
}

/**
 * `source` if `token` was issued for it, this target and today (or
 * yesterday, within the grace after midnight); otherwise "other". Compared
 * in constant time.
 */
export async function verifiedViewSource(
  target: ViewTarget,
  source: ViewSource,
  token: string | null | undefined,
  now: Date,
): Promise<ViewSource> {
  if (!token) return "other";
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = [utcDay(now)];
  if (now.getTime() - startOfDay < VIEW_SOURCE_TOKEN_GRACE_MS) days.push(utcDay(new Date(startOfDay - 1)));
  for (const day of days) {
    if (await timingSafeEqualStrings(token, await viewSourceToken(target, source, day))) return source;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// The dedupe cookie
// ---------------------------------------------------------------------------

export type ViewTarget = { kind: "profile" | "event"; id: string };

/** A short keyed hash naming a target in the cookie (not reversible without AUTH_SECRET). */
export async function targetToken(target: ViewTarget): Promise<string> {
  return (await keyedHash("view-target", `${target.kind}:${target.id}`)).slice(0, 12);
}

async function signature(day: string, tokens: readonly string[]): Promise<string> {
  return (await keyedHash("view-cookie", `${day}|${tokens.join("-")}`)).slice(0, 24);
}

/** The cookie value for `day` listing `tokens`: "day.tok-tok.sig". */
export async function encodeViewCookie(day: string, tokens: readonly string[]): Promise<string> {
  return `${day}.${tokens.join("-")}.${await signature(day, tokens)}`;
}

/**
 * The tokens a cookie lists for `day`. A cookie from another day, a forged
 * or damaged one, or none at all lists nothing.
 */
export async function decodeViewCookie(value: string | null | undefined, day: string): Promise<string[]> {
  if (!value) return [];
  const [cookieDay, list = "", sig] = value.split(".");
  if (cookieDay !== day || !sig) return [];
  const tokens = list ? list.split("-") : [];
  if (tokens.length > VIEW_COOKIE_MAX_TARGETS || tokens.some((token) => !/^[0-9a-f]{12}$/.test(token))) return [];
  return sig === (await signature(day, tokens)) ? tokens : [];
}

/** Seconds from `now` to the end of its UTC day: the cookie's lifetime. */
export function secondsToEndOfDay(now: Date): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}

// ---------------------------------------------------------------------------
// The limiter (no database writes)
// ---------------------------------------------------------------------------

/** Cloudflare's Rate Limiting binding, or a stand-in with the same shape. */
export type ViewLimiter = { limit: (options: { key: string }) => Promise<{ success: boolean }> };

/** The two limiters countView consults: per member or address, and one for all signed-out views. */
export type ViewLimiters = { perClient: ViewLimiter; anonymous: ViewLimiter };

/**
 * A fixed-window limiter in this process's memory, for `next dev`, `next
 * start` and tests, where the Cloudflare binding does not exist. Bounded:
 * it forgets every key when its window passes.
 */
export function memoryViewLimiter(
  limit: number = VIEW_RATE_LIMIT.limit,
  periodMs: number = VIEW_RATE_LIMIT.periodSeconds * 1000,
  now: () => number = Date.now,
): ViewLimiter {
  let windowStart = now();
  let counts = new Map<string, number>();
  return {
    limit: async ({ key }) => {
      if (now() - windowStart >= periodMs) {
        windowStart = now();
        counts = new Map();
      }
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    },
  };
}

/** In-memory stand-ins for both limiters, with the production limits. */
export function memoryViewLimiters(now: () => number = Date.now): ViewLimiters {
  return {
    anonymous: memoryViewLimiter(VIEW_ANON_LIMIT.limit, VIEW_ANON_LIMIT.periodSeconds * 1000, now),
    perClient: memoryViewLimiter(VIEW_RATE_LIMIT.limit, VIEW_RATE_LIMIT.periodSeconds * 1000, now),
  };
}

/** The key every signed-out view shares in the anonymous limiter. */
const ANONYMOUS_KEY = "anonymous";

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

type ViewCounterDb = {
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
  event: { findFirst: (args: { select: { photographer: { select: { userId: true } } }; where: { id: string } }) => Promise<{ photographer: { userId: string } } | null> };
  photographer: { findFirst: (args: { select: { userId: true }; where: { userId: string } }) => Promise<{ userId: string } | null> };
};

export type ViewRequest = {
  target: ViewTarget;
  /** The source the page's beacon reported; counted only with a matching `sourceToken`. */
  source: ViewSource;
  /** viewSourceToken() from the page render; missing or wrong files the view under "other". */
  sourceToken: string | null;
  /** Signed-in member, or null. */
  viewerId: string | null;
  /** The client address (already trusted, an IPv6 address as its /64, per clientIp.ts); keys the limiter when signed out. */
  clientIp: string;
  userAgent: string | null;
  /** The VIEW_COOKIE value the browser sent. */
  cookie: string | null;
  now?: Date;
};

export type ViewOutcome =
  | "counted"
  | "bot"
  | "already_counted"
  | "cookie_full"
  | "rate_limited"
  | "sign_in_required"
  | "not_found"
  | "self";

export type ViewResult = {
  outcome: ViewOutcome;
  /** The cookie to set, when it changed. */
  cookie: string | null;
};

/**
 * Whether `viewer` ("member:<id>" or "ip:<address>") is seen for `target` on
 * `day` for the first time: inserts the opaque (viewer, target, day) key and
 * says whether it was new. One statement, so two devices racing insert it
 * once.
 */
async function firstSeenToday(db: ViewCounterDb, viewer: string, target: ViewTarget, day: string): Promise<boolean> {
  const key = await keyedHash("view-seen", `${viewer}|${target.kind}:${target.id}|${day}`);
  const inserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO "ViewSeen" ("key", "day") VALUES (${key}, ${day}) ON CONFLICT ("key") DO NOTHING`);
  return inserted > 0;
}

/**
 * Decides whether this request is a new view and, if so, counts it. Reads
 * or writes the database only after the limiters admitted it, and writes a
 * count only when it returns "counted".
 */
export async function countView(db: ViewCounterDb, limiters: ViewLimiters, request: ViewRequest): Promise<ViewResult> {
  const now = request.now ?? new Date();
  const day = utcDay(now);
  const unchanged = (outcome: ViewOutcome): ViewResult => ({ cookie: null, outcome });

  if (isLikelyBot(request.userAgent)) return unchanged("bot");
  // Events are only shown to members.
  if (request.target.kind === "event" && !request.viewerId) return unchanged("sign_in_required");

  const tokens = await decodeViewCookie(request.cookie, day);
  const token = await targetToken(request.target);
  if (tokens.includes(token)) return unchanged("already_counted");
  // A full list stops a signed-out browser for the day; members are deduped
  // by ViewSeen instead, so they keep counting past it.
  if (!request.viewerId && tokens.length >= VIEW_COOKIE_MAX_TARGETS) return unchanged("cookie_full");

  // Before any database access: a refused request costs nothing.
  const clientKey = request.viewerId ? `member:${request.viewerId}` : `ip:${await keyedHash("view-ip", request.clientIp)}`;
  if (!(await limiters.perClient.limit({ key: clientKey })).success) return unchanged("rate_limited");
  if (!request.viewerId && !(await limiters.anonymous.limit({ key: ANONYMOUS_KEY })).success) {
    return unchanged("rate_limited");
  }

  const ownerId =
    request.target.kind === "profile"
      ? (await db.photographer.findFirst({ select: { userId: true }, where: { userId: request.target.id } }))?.userId
      : (await db.event.findFirst({ select: { photographer: { select: { userId: true } } }, where: { id: request.target.id } }))
          ?.photographer.userId;
  if (!ownerId) return unchanged("not_found");

  // The newest targets, at most the cookie's maximum (a member can pass it).
  const cookie = await encodeViewCookie(day, [...tokens, token].slice(-VIEW_COOKIE_MAX_TARGETS));
  if (ownerId === request.viewerId) return { cookie, outcome: "self" };
  // Once a day per target: a member on any device; signed out, an address,
  // whatever its cookie says (a script that drops cookies counts once).
  const viewer = request.viewerId ? `member:${request.viewerId}` : `ip:${request.clientIp}`;
  if (!(await firstSeenToday(db, viewer, request.target, day))) return { cookie, outcome: "already_counted" };

  if (request.target.kind === "profile") {
    const source = await verifiedViewSource(request.target, request.source, request.sourceToken, now);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "ProfileView" ("userId", "day", "source", "count") VALUES (${ownerId}, ${day}, ${source}, 1)
      ON CONFLICT ("userId", "day", "source") DO UPDATE SET "count" = "count" + 1`);
  } else {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "EventView" ("eventId", "day", "count") VALUES (${request.target.id}, ${day}, 1)
      ON CONFLICT ("eventId", "day") DO UPDATE SET "count" = "count" + 1`);
  }
  return { cookie, outcome: "counted" };
}

/** Deletes the ViewSeen keys of days before `now`'s UTC day: they decide nothing any more. */
export async function purgeViewSeen(db: Pick<ViewCounterDb, "$executeRaw">, now: Date): Promise<number> {
  return db.$executeRaw(Prisma.sql`DELETE FROM "ViewSeen" WHERE "day" < ${utcDay(now)}`);
}
