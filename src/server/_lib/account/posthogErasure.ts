// Deleting a deleted account's analytics: the PostHog person whose
// distinct id is the user id, with its events and session recordings.
//
// PostHog's private API: POST /api/projects/<project id>/persons/bulk_delete/
// with `distinct_ids`, on the PostHog *app* host of the region the events
// were sent to. Deletion is asynchronous on PostHog's side (it answers 202),
// and asking again for a person already deleted is harmless, so the step is
// idempotent.

import { env } from "~/env";
import { resolvePostHogHosts } from "~/telemetryConfig";

export type PostHogErasureConfig = {
  /** A personal API key with the person:write scope. */
  apiKey: string;
  /** The PostHog app origin (us.posthog.com, eu.posthog.com, or self-hosted). */
  appHost: string;
  projectId: string;
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The app host for an ingestion host: PostHog Cloud ingests on
 * `<region>.i.posthog.com` and serves its API on `<region>.posthog.com`; a
 * self-hosted instance serves both on one origin.
 */
export function posthogAppHost(ingestionHost: string): string {
  const url = new URL(ingestionHost);
  const cloud = /^([a-z0-9-]+)\.i\.posthog\.com$/.exec(url.hostname);
  if (cloud) url.hostname = `${cloud[1]}.posthog.com`;
  return url.origin;
}

/** The configuration from the environment, or null when it is not set. */
export function posthogErasureConfig(
  vars: { POSTHOG_HOST?: string; POSTHOG_PERSONAL_API_KEY?: string; POSTHOG_PROJECT_ID?: string } = env,
): PostHogErasureConfig | null {
  if (!vars.POSTHOG_PERSONAL_API_KEY || !vars.POSTHOG_PROJECT_ID) return null;
  return {
    apiKey: vars.POSTHOG_PERSONAL_API_KEY,
    appHost: posthogAppHost(resolvePostHogHosts({ POSTHOG_HOST: vars.POSTHOG_HOST }).apiHost),
    projectId: vars.POSTHOG_PROJECT_ID,
  };
}

/**
 * Asks PostHog to delete the person `distinctId` with its events and
 * recordings. "skipped" when not configured (the caller records and reports
 * it). Throws when PostHog refuses, so the deletion step is retried.
 */
export async function erasePostHogPerson(
  distinctId: string,
  config: PostHogErasureConfig | null = posthogErasureConfig(),
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<"requested" | "skipped"> {
  if (!config) return "skipped";
  const response = await fetchImpl(
    // PostHog's docs name delete_events and delete_recordings as parameters of
    // this endpoint; they are sent both in the query and in the body, so
    // either reading of them deletes the events and recordings.
    `${config.appHost}/api/projects/${encodeURIComponent(config.projectId)}/persons/bulk_delete/?delete_events=true&delete_recordings=true`,
    {
      body: JSON.stringify({ delete_events: true, delete_recordings: true, distinct_ids: [distinctId] }),
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      method: "POST",
    },
  );
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`PostHog refused the person deletion (HTTP ${response.status})`);
  return "requested";
}
