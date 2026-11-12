/**
 * When to try `message.markThreadRead` again after it failed, while the
 * thread stays open: after 5 s, 10 s, 20 s, 40 s, then every 60 s, and no
 * more after MARK_READ_MAX_RETRIES failures in a row for the same thread
 * view (the next message or visit marks the thread anyway). Null: give up.
 */
export const MARK_READ_MAX_RETRIES = 6;
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

export function markReadRetryDelayMs(consecutiveFailures: number): number | null {
  if (consecutiveFailures < 1) return FIRST_RETRY_MS;
  if (consecutiveFailures > MARK_READ_MAX_RETRIES) return null;
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (consecutiveFailures - 1));
}
