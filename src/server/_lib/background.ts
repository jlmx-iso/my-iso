import type { ExecutionContext, IncomingRequestCfProperties } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import { logger } from "~/_utils";

/**
 * Runs `task` without making the response wait for it.
 *
 * On Cloudflare the promise is handed to `waitUntil`, which keeps the Worker
 * alive until it settles. Elsewhere (`next dev`, `next start`, tests) the
 * process outlives the response anyway. Failures are logged, never thrown.
 */
export function runAfterResponse(name: string, task: () => Promise<unknown>): void {
  const promise = task().catch((error: unknown) => {
    logger.error("Background task failed", { error, task: name });
  });

  try {
    getCloudflareContext<IncomingRequestCfProperties, ExecutionContext>().ctx.waitUntil(promise);
  } catch {
    // Not running on Cloudflare.
  }
}
