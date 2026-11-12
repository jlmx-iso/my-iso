import type { PostHogSettings } from "~/_lib/posthogServer";
import { env } from "~/env";
import { resolvePostHogHosts } from "~/telemetryConfig";

/** Null when analytics are off: no project token, or the test suite. */
export function getPostHogSettings(): PostHogSettings | null {
  if (env.NODE_ENV === "test") return null;
  const apiKey = env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    // Undefined only when env validation is skipped (tests, some builds).
    environment: env.APP_ENV ?? "development",
    host: resolvePostHogHosts({ POSTHOG_HOST: env.POSTHOG_HOST }).apiHost,
  };
}
