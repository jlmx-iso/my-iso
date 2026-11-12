// Server-side PostHog, shaped for Cloudflare Workers.
//
// A Worker isolate can be frozen or discarded as soon as its response is
// sent, so nothing here relies on a long-lived client or a background flush
// timer: each send creates a client, sends immediately (`flushAt: 1`), and
// shuts the client down before its promise resolves. Callers hand that
// promise to `waitUntil` (see ~/server/_lib/background and worker.ts).
//
// Shared by the Next.js app and the Worker entry, so it takes its settings
// as arguments and imports nothing app-specific.

import { PostHog } from "posthog-node";

export type PostHogSettings = {
  /** Project token (phc_...). */
  apiKey: string;
  /** Deployment name, attached to every event as `environment`. */
  environment: string;
  /** Ingestion origin, e.g. https://us.i.posthog.com. */
  host: string;
};

export type ServerEvent = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
};

export type ExceptionContext = {
  /** User id. Never an email address. Omit for anonymous errors. */
  distinctId?: string;
  /** Request path, without the query string. */
  path?: string;
  /** Small, non-sensitive details (procedure name, job name, error code). */
  extra?: Record<string, string | number | boolean | null | undefined>;
  /** Where it was caught, e.g. "trpc", "worker", "job:expire-matches". */
  source: string;
};

/** How long a send may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 5_000;

function createClient(settings: PostHogSettings): PostHog {
  return new PostHog(settings.apiKey, {
    // No uncaught-exception hooks: errors are reported where they are caught.
    enableExceptionAutocapture: false,
    fetchRetryCount: 1,
    flushAt: 1,
    flushInterval: 0,
    host: settings.host,
    requestTimeout: REQUEST_TIMEOUT_MS,
  });
}

/**
 * Runs `run` with a fresh client and always shuts the client down, which
 * flushes anything still queued.
 */
export async function withPostHog<T>(
  settings: PostHogSettings,
  run: (client: PostHog) => Promise<T>,
): Promise<T> {
  const client = createClient(settings);
  try {
    return await run(client);
  } finally {
    await client.shutdown(REQUEST_TIMEOUT_MS);
  }
}

/** Sends one event and resolves once PostHog has it (or the send failed). */
export async function sendEvent(settings: PostHogSettings, event: ServerEvent): Promise<void> {
  await withPostHog(settings, (client) =>
    client.captureImmediate({
      distinctId: event.distinctId,
      event: event.event,
      properties: { ...event.properties, environment: settings.environment },
    }),
  );
}

/** Drops the query string and fragment: they can carry tokens and emails. */
export function pathOnly(pathOrUrl: string): string {
  const end = pathOrUrl.search(/[?#]/);
  return end === -1 ? pathOrUrl : pathOrUrl.slice(0, end);
}

/**
 * Reports an exception to PostHog error tracking and resolves once sent.
 *
 * Only what is listed in `context` goes with it: never request bodies,
 * cookies or authorization headers.
 */
export async function sendException(
  settings: PostHogSettings,
  error: unknown,
  context: ExceptionContext,
): Promise<void> {
  const properties: Record<string, unknown> = {
    ...context.extra,
    environment: settings.environment,
    source: context.source,
  };
  if (context.path) properties.path = pathOnly(context.path);

  await withPostHog(settings, (client) =>
    client.captureExceptionImmediate(error, context.distinctId, properties),
  );
}
