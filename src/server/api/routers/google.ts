import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { placeAutocomplete } from "~/server/_lib/google";
import { keyedHash } from "~/server/_utils/hash";
import { enforceRateLimit, RateLimits } from "~/server/_utils/rateLimit";

import { createTRPCRouter, protectedProcedure } from "../trpc";

/** Shorter inputs are answered with no suggestions, without calling Google. */
export const PLACES_MIN_QUERY_LENGTH = 3;

/** How long one server-derived Places session lasts. */
const PLACES_SESSION_MS = 3 * 60 * 1000;

/**
 * A Places "session token" groups the keystrokes of one search so Google
 * bills them as a single session. Clients may send their own (a UUID per
 * search box). Otherwise one is derived per user per three-minute window,
 * which gives consecutive keystrokes the same token without a client change.
 */
async function derivePlacesSessionToken(userId: string, nowMs: number): Promise<string> {
  const window = Math.floor(nowMs / PLACES_SESSION_MS);
  const hex = await keyedHash("places-session", `${userId}:${window}`);
  // Formatted as a version-4 UUID, which is what the API recommends.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export const googleRouter = createTRPCRouter({
    /**
     * City suggestions from the Google Places API. Signed-in users only and
     * rate limited per user: every call is billed to the app's API key.
     */
    getAutocompleteLocations: protectedProcedure
        .input(z.object({
            query: z.string().max(100),
            sessionToken: z.string().uuid().optional(),
        }))
        .query(async ({ ctx, input }) => {
            const query = input.query.trim();
            if (query.length < PLACES_MIN_QUERY_LENGTH) return [];

            // Counted here, after the length check: only calls that reach
            // Google use up the caller's allowance.
            const userId = ctx.session.user.id;
            await enforceRateLimit(ctx.db, RateLimits.PLACES_AUTOCOMPLETE, `user:${userId}`);

            const sessionToken =
                input.sessionToken ??
                (await derivePlacesSessionToken(userId, Date.now()));

            const result = await placeAutocomplete(query, sessionToken);

            if (result.isErr) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to fetch location suggestions'
                });
            }

            return result.value;
        }),
});
