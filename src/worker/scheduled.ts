// Cron Triggers -> scheduled jobs. Runs in the Worker entry (worker.ts) and
// is type-checked via tsconfig.worker.json.
//
// The jobs themselves live in the Next.js app (src/server/_jobs), where the
// database client is. The Worker reaches them through an internal request
// to the app it wraps, so nothing is bundled twice.

import { JOBS_ROUTE_PREFIX, jobToken } from "../_lib/jobToken";
import { scrubErrorForLog } from "../_lib/telemetryScrub";

/**
 * Which jobs each Cron Trigger runs. The expressions must match `crons` in
 * wrangler.toml exactly (both environments); src/server/_jobs/jobs.test.ts
 * fails when they drift.
 */
export const CRON_JOBS: Readonly<Record<string, readonly string[]>> = {
  // Every 15 minutes: matches expire 72 hours after they are made.
  "*/15 * * * *": ["expire-matches"],
  // Daily, 03:17 UTC: housekeeping.
  "17 3 * * *": ["purge-expired", "reconcile-invites"],
};

export type JobRun = { job: string; ok: boolean; status: number };

/** Sends a request to the Next.js app inside this Worker. */
export type AppFetch = (request: Request) => Promise<Response>;

/**
 * Runs the jobs of one Cron Trigger, one after the other, and reports how
 * each went. A job that fails does not stop the ones after it. Throws for a
 * cron expression that has no jobs, so a mismatch with wrangler.toml is
 * loud.
 */
export async function runScheduledJobs(
  cron: string,
  options: { appFetch: AppFetch; authSecret: string | undefined },
): Promise<JobRun[]> {
  const jobs = CRON_JOBS[cron];
  if (!jobs) throw new Error(`No jobs are configured for cron "${cron}"`);
  if (!options.authSecret) throw new Error("AUTH_SECRET is not set; scheduled jobs cannot run");

  const runs: JobRun[] = [];
  for (const job of jobs) {
    try {
      const response = await options.appFetch(
        // The host is never resolved: the request is handed to the app
        // directly, not sent over the network.
        new Request(`https://scheduled.internal${JOBS_ROUTE_PREFIX}/${job}`, {
          headers: { Authorization: `Bearer ${await jobToken(options.authSecret, job)}` },
          method: "POST",
        }),
      );
      // Drain the body so the connection is released.
      await response.arrayBuffer();
      runs.push({ job, ok: response.ok, status: response.status });
    } catch (error) {
      console.error(`Scheduled job ${job} could not be started`, scrubErrorForLog(error));
      runs.push({ job, ok: false, status: 0 });
    }
  }
  return runs;
}
