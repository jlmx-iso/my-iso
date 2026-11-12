// What Claude writes for a match (see ./ai): generated once, stored on the
// Match row, and read from there ever after.
//
// Generation never runs inside a request: callers hand these functions to
// `runAfterResponse`. Cost is bounded three ways:
// - once per match: text is stored, and only written while still empty;
// - a claim on the match (`icebreakersRequestedAt`) stops concurrent and
//   back-to-back attempts, so a failing provider is retried at most every
//   RETRY_AFTER_MS per match, however often the page is opened;
// - a daily cap per member on generations they cause (AI_GENERATION_DAILY).

import { logger } from "~/_utils";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { checkRateLimit, type RateLimitDb, type RateLimitPolicy } from "~/server/_utils/rateLimit";

import {
  type AiFailure,
  generateIcebreakers,
  generateMatchSummary,
  isAiEnabled,
  parseStoredIcebreakers,
  type UserProfile,
} from "./ai";

type InsightsDb = Pick<ExtendedPrismaClient, "match" | "user"> & RateLimitDb;

/**
 * AI generations one member may cause per day (a match makes two: summary
 * and icebreakers). Far above normal use; it exists to cap the bill if an
 * account is used to churn matches. Fails closed: with the limiter down,
 * nothing is generated.
 */
export const AI_GENERATION_DAILY = {
  limit: 40,
  name: "ai-generation-daily",
  onError: "deny",
  windowSeconds: 24 * 60 * 60,
} as const satisfies RateLimitPolicy;

/** A match whose icebreakers failed to generate is retried after this long. */
export const RETRY_AFTER_MS = 15 * 60 * 1000;

export type IcebreakersStatus =
  /** Stored and returned. */
  | "ready"
  /** Being generated, or due to be: ask again shortly. */
  | "pending"
  /** AI features are switched off (no API key); none will arrive. */
  | "unavailable";

export type GenerationOutcome =
  | "generated"
  /** Already stored, or another run holds the claim. */
  | "skipped"
  | "rate_limited"
  | "not_found"
  | AiFailure;

const PROFILE_SELECT = {
  city: true,
  firstName: true,
  lastName: true,
  photographer: {
    select: {
      bio: true,
      companyName: true,
      location: true,
      name: true,
      portfolioImages: {
        select: { tags: true, title: true },
        take: 10,
        where: { isDeleted: false },
      },
      reviews: { select: { rating: true }, take: 50 },
    },
  },
  state: true,
} as const;

async function loadProfiles(
  db: InsightsDb,
  matchId: string,
): Promise<[UserProfile, UserProfile] | null> {
  const match = await db.match.findUnique({
    select: { user1Id: true, user2Id: true },
    where: { id: matchId },
  });
  if (!match) return null;

  const [user1, user2] = await Promise.all([
    db.user.findUnique({ select: PROFILE_SELECT, where: { id: match.user1Id } }),
    db.user.findUnique({ select: PROFILE_SELECT, where: { id: match.user2Id } }),
  ]);
  return user1 && user2 ? [user1, user2] : null;
}

async function withinDailyCap(db: InsightsDb, userId: string): Promise<boolean> {
  const result = await checkRateLimit(db, AI_GENERATION_DAILY, `user:${userId}`);
  if (!result.allowed) logger.warn("AI generation skipped: daily cap reached");
  return result.allowed;
}

/** What `getMatchById` returns for a match's stored icebreakers. */
export function readIcebreakers(stored: string | null): {
  icebreakers: string[];
  icebreakersStatus: IcebreakersStatus;
} {
  const icebreakers = parseStoredIcebreakers(stored);
  if (icebreakers) return { icebreakers, icebreakersStatus: "ready" };
  // A stored value that does not parse is never regenerated (generation
  // only claims a match whose icebreakers are null), so it is not pending.
  if (stored !== null) return { icebreakers: [], icebreakersStatus: "unavailable" };
  return { icebreakers: [], icebreakersStatus: isAiEnabled() ? "pending" : "unavailable" };
}

/**
 * Generates and stores the icebreakers of a match that has none yet.
 * `requestedBy` is the member whose action caused it (counted against
 * their daily cap). Safe to call on every page view: all but the first
 * call in RETRY_AFTER_MS return "skipped" after one cheap UPDATE.
 */
export async function ensureIcebreakers(
  db: InsightsDb,
  params: { matchId: string; now?: Date; requestedBy: string },
): Promise<GenerationOutcome> {
  if (!isAiEnabled()) return "disabled";
  const now = params.now ?? new Date();

  // The claim. One conditional UPDATE, so of any number of concurrent
  // callers exactly one proceeds.
  const claim = await db.match.updateMany({
    data: { icebreakersRequestedAt: now },
    where: {
      icebreakers: null,
      id: params.matchId,
      OR: [
        { icebreakersRequestedAt: null },
        { icebreakersRequestedAt: { lt: new Date(now.getTime() - RETRY_AFTER_MS) } },
      ],
    },
  });
  if (claim.count === 0) return "skipped";

  if (!(await withinDailyCap(db, params.requestedBy))) return "rate_limited";

  const profiles = await loadProfiles(db, params.matchId);
  if (!profiles) return "not_found";

  const result = await generateIcebreakers(...profiles);
  if (!result.ok) return result.reason;

  await db.match.updateMany({
    data: { icebreakers: JSON.stringify(result.value) },
    where: { icebreakers: null, id: params.matchId },
  });
  return "generated";
}

/** Generates and stores the summary of a match that has none yet. */
export async function ensureMatchSummary(
  db: InsightsDb,
  params: { matchId: string; requestedBy: string },
): Promise<GenerationOutcome> {
  if (!isAiEnabled()) return "disabled";
  const existing = await db.match.findUnique({
    select: { aiSummary: true },
    where: { id: params.matchId },
  });
  if (!existing) return "not_found";
  if (existing.aiSummary) return "skipped";

  if (!(await withinDailyCap(db, params.requestedBy))) return "rate_limited";

  const profiles = await loadProfiles(db, params.matchId);
  if (!profiles) return "not_found";

  const result = await generateMatchSummary(...profiles);
  if (!result.ok) return result.reason;

  await db.match.updateMany({
    data: { aiSummary: result.value },
    where: { aiSummary: null, id: params.matchId },
  });
  return "generated";
}

/**
 * Everything a new match gets, run once right after it is created.
 * The two generations are independent: one failing does not stop the other.
 */
export async function generateMatchInsights(
  db: InsightsDb,
  params: { matchId: string; requestedBy: string },
): Promise<{ icebreakers: GenerationOutcome; summary: GenerationOutcome }> {
  const [summary, icebreakers] = await Promise.all([
    ensureMatchSummary(db, params),
    ensureIcebreakers(db, params),
  ]);
  logger.info("Match insights generated", { icebreakers, matchId: params.matchId, summary });
  return { icebreakers, summary };
}
