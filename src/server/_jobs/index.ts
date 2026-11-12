// Scheduled maintenance. The Worker's `scheduled` handler (worker.ts) maps
// each Cron Trigger to job names (src/worker/scheduled.ts) and calls
// POST /api/internal/jobs/<name>, which runs the job here.
//
// Every job is small, idempotent and safe to run at any time or twice.

import { logger } from "~/_utils";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";
import { captureServerException } from "~/server/_lib/posthog";

import { expireStaleMatches } from "./expireStaleMatches";
import { purgeExpired } from "./purgeExpired";
import { reconcileInviteSlots } from "./reconcileInviteSlots";

type JobSummary = Record<string, number>;
type Job = (db: ExtendedPrismaClient, now: Date) => Promise<JobSummary>;

export const JOBS = {
  "expire-matches": expireStaleMatches,
  "purge-expired": purgeExpired,
  "reconcile-invites": reconcileInviteSlots,
} as const satisfies Record<string, Job>;

export type JobName = keyof typeof JOBS;

export function isJobName(name: string): name is JobName {
  return Object.hasOwn(JOBS, name);
}

export type JobOutcome =
  | { durationMs: number; job: JobName; ok: true; summary: JobSummary }
  | { durationMs: number; job: JobName; ok: false };

/**
 * Runs one job, logs its summary and reports a failure to error tracking.
 * Never throws: a failed job must not stop the others in the same trigger.
 */
export async function runJob(
  name: JobName,
  db: ExtendedPrismaClient,
  now: Date = new Date(),
): Promise<JobOutcome> {
  const startedAt = Date.now();
  try {
    const summary: JobSummary = await JOBS[name](db, now);
    const durationMs = Date.now() - startedAt;
    logger.info("Scheduled job finished", { durationMs, job: name, ...summary });
    return { durationMs, job: name, ok: true, summary };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logger.error("Scheduled job failed", { durationMs, error, job: name });
    captureServerException(error, { extra: { job: name }, source: `job:${name}` });
    return { durationMs, job: name, ok: false };
  }
}
