import { isClientError } from "./userError";

/** Attempts after the first one for failures that may be transient. */
export const MAX_QUERY_RETRIES = 2;

/**
 * react-query `retry` for every query: a request the server refused (400s:
 * invalid, not signed in, not allowed, not found, rate limited) is not asked
 * again, because the answer would be the same and, for a rate limit, each
 * retry counts against the limit. Network failures and server errors are
 * retried a couple of times.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isClientError(error)) return false;
  return failureCount < MAX_QUERY_RETRIES;
}
