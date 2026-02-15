import { env } from "~/env";
import { Result } from "~/_utils/result";
import { logger } from "~/_utils";

/**
 * Edge-compatible PostHog event capture using fetch API
 * Migrated from posthog-node for Cloudflare Workers compatibility
 */
export async function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, any>
): Promise<Result<void, Error>> {
  try {
    const response = await fetch(`${env.NEXT_PUBLIC_POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY,
        event,
        properties,
        distinct_id: distinctId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn('PostHog capture failed', { status: response.status, error: errorText });
      // Return ok anyway - don't break user flows due to analytics failures
      return Result.ok(undefined);
    }

    return Result.ok(undefined);
  } catch (error) {
    logger.error('PostHog capture exception', { error });
    // Return ok anyway - don't break user flows due to analytics failures
    return Result.ok(undefined);
  }
}

/**
 * Deprecated: posthogClient export for backwards compatibility
 * Use captureEvent() instead for edge-compatible analytics
 */
export const posthogClient = {
  capture: async (options: { distinctId: string; event: string; properties?: Record<string, any> }) => {
    return captureEvent(options.distinctId, options.event, options.properties);
  },
};