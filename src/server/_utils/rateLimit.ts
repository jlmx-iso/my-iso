/**
 * Rate Limiting for Cloudflare Workers/Pages
 *
 * SETUP REQUIRED:
 * 1. Create KV namespace: `wrangler kv:namespace create RATE_LIMITER`
 * 2. Update wrangler.toml with the namespace ID from step 1
 * 3. For local dev: `wrangler kv:namespace create RATE_LIMITER --preview`
 * 4. Add preview_id to wrangler.toml
 *
 * USAGE:
 * ```typescript
 * import { checkRateLimit } from "~/server/_utils/rateLimit";
 *
 * // In API route or tRPC procedure:
 * const result = await checkRateLimit(identifier, { limit: 10, window: 60 });
 * if (!result.allowed) {
 *   throw new TRPCError({
 *     code: 'TOO_MANY_REQUESTS',
 *     message: `Rate limit exceeded. Try again in ${result.retryAfter}s`
 *   });
 * }
 * ```
 */

import type { KVNamespace } from "@cloudflare/workers-types";

import { logger } from "~/_utils";

export type RateLimitConfig = {
  /** Maximum number of requests allowed in the time window */
  limit: number;
  /** Time window in seconds */
  window: number;
};

export type RateLimitResult = {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in current window */
  remaining: number;
  /** Seconds until rate limit resets */
  retryAfter: number;
};

/**
 * Get KV namespace for rate limiting
 * Available via Cloudflare Workers binding
 */
const getRateLimiterKV = (): KVNamespace | undefined => {
  if (typeof globalThis !== 'undefined' && 'RATE_LIMITER' in globalThis) {
    const kv = (globalThis as { RATE_LIMITER?: unknown }).RATE_LIMITER;

    // Runtime validation: KVNamespace should have get/put/delete methods
    if (
      kv &&
      typeof kv === 'object' &&
      'get' in kv &&
      'put' in kv &&
      typeof kv.get === 'function' &&
      typeof kv.put === 'function'
    ) {
      return kv as KVNamespace;
    }
  }
  return undefined;
};

/**
 * Check if a request is within rate limits
 * Uses sliding window algorithm with Cloudflare KV
 *
 * @param identifier - Unique identifier for rate limiting (e.g., user ID, IP address)
 * @param config - Rate limit configuration
 * @returns Rate limit result with allowed status and metadata
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const kv = getRateLimiterKV();

  // If KV is not available (local dev without KV setup), allow all requests
  // Log warning so developers know rate limiting is not active
  if (!kv) {
    logger.warn('Rate limiting KV namespace not available - allowing request', {
      identifier,
      environment: process.env.NODE_ENV
    });
    return {
      allowed: true,
      remaining: config.limit,
      retryAfter: 0,
    };
  }

  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const windowMs = config.window * 1000;

  try {
    // Get current rate limit data
    const data = await kv.get(key, 'json') as {
      count: number;
      resetAt: number;
    } | null;

    // If no data or window expired, start fresh
    if (!data || now > data.resetAt) {
      const resetAt = now + windowMs;
      await kv.put(
        key,
        JSON.stringify({ count: 1, resetAt }),
        { expirationTtl: config.window }
      );

      return {
        allowed: true,
        remaining: config.limit - 1,
        retryAfter: 0,
      };
    }

    // Check if limit exceeded
    if (data.count >= config.limit) {
      const retryAfter = Math.ceil((data.resetAt - now) / 1000);

      logger.warn('Rate limit exceeded', {
        identifier,
        count: data.count,
        limit: config.limit,
        retryAfter
      });

      return {
        allowed: false,
        remaining: 0,
        retryAfter,
      };
    }

    // Increment counter
    const newCount = data.count + 1;
    await kv.put(
      key,
      JSON.stringify({ count: newCount, resetAt: data.resetAt }),
      { expirationTtl: Math.ceil((data.resetAt - now) / 1000) }
    );

    return {
      allowed: true,
      remaining: config.limit - newCount,
      retryAfter: 0,
    };
  } catch (error) {
    // If rate limiting fails, fail open (allow request) to prevent outages
    // Log error for monitoring
    logger.error('Rate limiting error - failing open', {
      error: error instanceof Error ? error.message : 'Unknown error',
      identifier
    });

    return {
      allowed: true,
      remaining: config.limit,
      retryAfter: 0,
    };
  }
}

/**
 * Common rate limit configurations
 * Adjust these based on your application's needs
 */
export const RateLimits = {
  /** Strict limit for sensitive operations (e.g., password reset, email verification) */
  STRICT: { limit: 5, window: 300 } as RateLimitConfig, // 5 requests per 5 minutes

  /** Standard limit for authenticated API requests */
  STANDARD: { limit: 100, window: 60 } as RateLimitConfig, // 100 requests per minute

  /** Generous limit for public endpoints */
  GENEROUS: { limit: 1000, window: 60 } as RateLimitConfig, // 1000 requests per minute

  /** Authentication attempts */
  AUTH: { limit: 10, window: 900 } as RateLimitConfig, // 10 attempts per 15 minutes
} as const;
