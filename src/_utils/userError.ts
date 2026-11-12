/**
 * Turns an error from a tRPC call, `fetch` or `signIn` into copy that is safe
 * and useful to show to a user.
 *
 * Server messages are only passed through when the server deliberately wrote
 * them for the user (a client-error code and a short, plain sentence). Zod
 * validation dumps, internal errors and transport failures get friendly copy.
 */

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";
export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach ISO. Check your connection and try again.";
export const RATE_LIMIT_MESSAGE =
  "Too many attempts. Please wait a moment and try again.";
export const SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Please sign in again.";

/** tRPC codes whose messages are written for the user. */
const USER_FACING_CODES = new Set([
  "BAD_REQUEST",
  "CONFLICT",
  "FORBIDDEN",
  "NOT_FOUND",
  "PRECONDITION_FAILED",
  "TOO_MANY_REQUESTS",
  "UNPROCESSABLE_CONTENT",
]);

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_network|err_internet/i;

type ErrorData = { code?: unknown; zodError?: unknown };

function readData(error: unknown): ErrorData | undefined {
  if (typeof error !== "object" || error === null || !("data" in error)) return undefined;
  const { data } = error;
  return typeof data === "object" && data !== null ? (data) : undefined;
}

function readMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return typeof error.message === "string" ? error.message : "";
  }
  return "";
}

/** A short plain sentence, not JSON, a stack trace or a database error. */
function isPlainSentence(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 160) return false;
  if (/^[[{]/.test(trimmed)) return false;
  if (trimmed.includes("\n")) return false;
  return !/prisma|sqlite|d1_|invalid `|unexpected token|at \w+ \(|undefined|null\b/i.test(trimmed);
}

/** The tRPC error code of a failed call ("CONFLICT", "FORBIDDEN", ...), if it has one. */
export function trpcErrorCode(error: unknown): string | undefined {
  const code = readData(error)?.code;
  return typeof code === "string" ? code : undefined;
}

export function isNetworkError(error: unknown): boolean {
  if (readData(error)) return false;
  if (error instanceof TypeError) return true;
  return NETWORK_PATTERN.test(readMessage(error));
}

/**
 * First validation message per input field from a tRPC Zod error, for showing
 * next to the field it belongs to. Empty when the error is not a validation
 * error.
 */
export function zodFieldErrors(error: unknown): Record<string, string> {
  const zodError = readData(error)?.zodError;
  if (typeof zodError !== "object" || zodError === null || !("fieldErrors" in zodError)) return {};
  const { fieldErrors } = zodError;
  if (typeof fieldErrors !== "object" || fieldErrors === null) return {};

  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    const [first] = Array.isArray(messages) ? (messages as unknown[]) : [];
    if (typeof first === "string" && isPlainSentence(first)) result[field] = first;
  }
  return result;
}

export function userFacingError(
  error: unknown,
  fallback: string = GENERIC_ERROR_MESSAGE,
): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;

  const data = readData(error);
  const code = typeof data?.code === "string" ? data.code : undefined;
  const message = readMessage(error);

  if (code === "UNAUTHORIZED") return SESSION_EXPIRED_MESSAGE;
  if (data?.zodError) return fallback;
  if (code === "TOO_MANY_REQUESTS") {
    return isPlainSentence(message) ? message : RATE_LIMIT_MESSAGE;
  }
  if (code && USER_FACING_CODES.has(code) && isPlainSentence(message)) return message;

  return fallback;
}
