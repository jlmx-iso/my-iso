import type { ExecutionContext, IncomingRequestCfProperties } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import { sendException } from "~/_lib/posthogServer";
import { logger } from "~/_utils";

import { getPostHogSettings } from "./posthogSettings";

/** Tasks that report to PostHog themselves; their failures are only logged. */
const TELEMETRY_TASK_PREFIX = "posthog:";

async function reportFailure(name: string, error: unknown): Promise<void> {
  logger.error("Background task failed", { error, task: name });
  if (name.startsWith(TELEMETRY_TASK_PREFIX)) return;

  const settings = getPostHogSettings();
  if (!settings) return;
  try {
    await sendException(settings, error, { extra: { task: name }, source: "background" });
  } catch (reportError) {
    logger.warn("Could not report background task failure", { error: reportError, task: name });
  }
}

/**
 * Runs `task` without making the response wait for it.
 *
 * On Cloudflare the promise is handed to `waitUntil`, which keeps the Worker
 * alive until it settles. Elsewhere (`next dev`, `next start`, tests) the
 * process outlives the response anyway.
 *
 * A failure never reaches the caller: it is logged and reported to error
 * tracking, inside the same kept-alive promise. This is the only place work
 * may be left running after a response; everything else is awaited.
 */
export function runAfterResponse(name: string, task: () => Promise<unknown>): void {
  const promise = (async () => {
    try {
      await task();
    } catch (error) {
      await reportFailure(name, error);
    }
  })();

  try {
    getCloudflareContext<IncomingRequestCfProperties, ExecutionContext>().ctx.waitUntil(promise);
  } catch {
    // Not running on Cloudflare.
  }
}
