/**
 * Stable, machine-readable reasons the API attaches to some errors, for the
 * client to turn into specific guidance. A tRPC error carries its reason in
 * `error.data.reason` (null when there is none); the HTTP status and tRPC
 * code are unchanged.
 *
 * Values are part of the API contract with the web and mobile clients: add
 * new ones, never rename.
 */
export const ErrorReason = {
  /**
   * `message.createThread` (429): the caller has opened as many NEW
   * conversations today as their allowance permits. Writing in existing
   * conversations still works.
   */
  NEW_CONVERSATION_LIMIT: "new_conversation_limit",
  /**
   * `photographer.addPortfolioImage` (400): the portfolio already holds the
   * maximum number of images. The error message says so and is safe to show.
   */
  PORTFOLIO_FULL: "portfolio_full",
  /**
   * `message.createThread`, `message.getRecipientById` (403): the caller may
   * not start a conversation with this person (they are not discoverable and
   * there is no match, active booking or earlier message from them), or
   * there is no such person; the two are deliberately indistinguishable.
   */
  RECIPIENT_NOT_MESSAGEABLE: "recipient_not_messageable",
} as const;

export type ErrorReason = (typeof ErrorReason)[keyof typeof ErrorReason];

/**
 * The reason carried by an error thrown by the tRPC client (or anything
 * else), or null.
 */
export function getErrorReason(error: unknown): ErrorReason | null {
  if (typeof error !== "object" || error === null || !("data" in error)) return null;
  const { data } = error;
  if (typeof data !== "object" || data === null || !("reason" in data)) return null;
  const { reason } = data;
  return Object.values(ErrorReason).find((known) => known === reason) ?? null;
}
